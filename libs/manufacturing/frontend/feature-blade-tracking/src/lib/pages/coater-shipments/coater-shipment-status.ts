/** How a coater shipment's stored status reads on screen, and the colour of its badge. */
const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  DRAFT: { label: 'Draft', tone: 'warning' },
  DISPATCHED: { label: 'Sent to coater', tone: 'success' },
  CANCELED: { label: 'Canceled', tone: 'neutral' },
};

export function coaterShipmentStatusLabel(status: string): string {
  return STATUS[status]?.label ?? status.replace(/_/g, ' ').toLowerCase().replace(/^./, (first) => first.toUpperCase());
}

export function coaterShipmentStatusTone(status: string): 'success' | 'warning' | 'neutral' {
  return STATUS[status]?.tone ?? 'neutral';
}
