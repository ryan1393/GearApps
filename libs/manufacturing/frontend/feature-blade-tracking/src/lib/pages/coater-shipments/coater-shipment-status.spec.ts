import { coaterShipmentStatusLabel, coaterShipmentStatusTone } from './coater-shipment-status';

describe('coater shipment status badge', () => {
  it('reads as words, not stored codes', () => {
    expect(coaterShipmentStatusLabel('DRAFT')).toBe('Draft');
    expect(coaterShipmentStatusLabel('DISPATCHED')).toBe('Sent to coater');
    expect(coaterShipmentStatusLabel('CANCELED')).toBe('Canceled');
    expect(coaterShipmentStatusLabel('NEEDS_REVIEW')).toBe('Needs review');
  });

  it('colours a draft as in progress and a sent shipment as done', () => {
    expect(coaterShipmentStatusTone('DRAFT')).toBe('warning');
    expect(coaterShipmentStatusTone('DISPATCHED')).toBe('success');
    expect(coaterShipmentStatusTone('CANCELED')).toBe('neutral');
  });
});
