# FANUC FOCAS library (not committed)

Put FANUC's licensed **Linux** FOCAS library here before starting the collector:

    apps/lapper-read-py/fanuc/libfwlib32.so

Use the 64-bit x86 build (`libfwlib32-linux-x64.so.*`) from your FOCAS2 package and
rename or symlink it to `libfwlib32.so`. Docker Compose mounts this folder read-only
at `/opt/fanuc` (override with `LAPPER_READ_FOCAS_DIR`).

The library is licensed by FANUC, so it is ignored by git and never baked into the image.
