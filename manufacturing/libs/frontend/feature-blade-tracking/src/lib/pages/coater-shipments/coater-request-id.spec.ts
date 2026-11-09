import { createCoaterRequestId } from './coater-request-id';

describe('Coater shipment idempotency IDs', () => {
  it('creates distinct RFC 4122 v4 IDs using the HTTP-compatible Web Crypto API', () => {
    const first = createCoaterRequestId();
    const second = createCoaterRequestId();
    const uuidV4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
    expect(first).toMatch(uuidV4);
    expect(second).toMatch(uuidV4);
    expect(first).not.toBe(second);
  });
});
