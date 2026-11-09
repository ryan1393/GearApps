"""Real benign PDF/raster/OCR compatibility checks for pinned dependencies."""
import importlib.util
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sap_capture_watcher as W

HAS_PYPDF = importlib.util.find_spec('pypdf') is not None
HAS_OCR = all(importlib.util.find_spec(name) is not None for name in ('fitz', 'PIL', 'pytesseract'))


@unittest.skipUnless(HAS_PYPDF and HAS_OCR, 'Install both pinned requirement files for actual PDF dependency checks')
class PdfDependencyTests(unittest.TestCase):
    def test_real_pdf_text_and_pixmap_image_roundtrip(self):
        import fitz
        from PIL import Image
        from pypdf import PdfReader
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'packing-slip.pdf'
            with fitz.open() as doc:
                page = doc.new_page()
                page.insert_text((50, 80), 'Packing Slip', fontsize=24)
                page.insert_text((50, 130), 'Delivery Number: 12345678', fontsize=24)
                doc.save(path)
            text = PdfReader(path, strict=True).pages[0].extract_text()
            self.assertEqual(W.classify_text(text), (True, '12345678'))
            verified = W.verify_layers(W.pdf_text_layers(path, False))
            self.assertTrue(verified.ok)
            self.assertEqual(verified.delivery_number, '12345678')
            with fitz.open(path) as doc:
                pix = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                image = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
                png = Path(folder) / 'raster.png'
                image.save(png)
                with Image.open(png) as reopened:
                    self.assertEqual(reopened.size, (pix.width, pix.height))

    @unittest.skipUnless(shutil.which('tesseract'), 'Install Tesseract for real OCR compatibility check')
    def test_real_raster_only_pdf_ocr(self):
        import fitz
        from PIL import Image, ImageDraw, ImageFont
        with tempfile.TemporaryDirectory() as folder:
            # Large legible text exercises the actual PyMuPDF -> Pillow -> pytesseract chain.
            font_path = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
            if not font_path.is_file():
                self.skipTest('DejaVuSans test font is unavailable')
            image = Image.new('RGB', (1800, 600), 'white')
            draw = ImageDraw.Draw(image)
            font = ImageFont.truetype(str(font_path), 60)
            draw.text((80, 100), 'Packing Slip', fill='black', font=font)
            draw.text((80, 250), 'Delivery Number: 12345678', fill='black', font=font)
            png = Path(folder) / 'scanned.png'
            image.save(png)
            pdf = Path(folder) / 'scanned.pdf'
            with fitz.open() as doc:
                page = doc.new_page(width=900, height=300)
                page.insert_image(page.rect, filename=str(png))
                doc.save(pdf)
            verified = W.verify_layers(W.pdf_text_layers(pdf, True))
            self.assertTrue(verified.ok, verified.reason)
            self.assertEqual((verified.method, verified.delivery_number), ('OCR', '12345678'))


if __name__ == '__main__':
    unittest.main()
