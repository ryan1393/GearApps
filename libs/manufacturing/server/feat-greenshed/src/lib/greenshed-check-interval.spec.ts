import { DEFAULT_GREENSHED_CHECK_INTERVAL, greenshedCheckInterval } from './greenshed.queries';

describe('greenshedCheckInterval', () => {
  const saved = process.env['GREENSHED_CHECK_INTERVAL'];
  afterEach(() => {
    if (saved === undefined) delete process.env['GREENSHED_CHECK_INTERVAL'];
    else process.env['GREENSHED_CHECK_INTERVAL'] = saved;
  });

  it('is 25 pieces unless an administrator changes it', () => {
    delete process.env['GREENSHED_CHECK_INTERVAL'];
    expect(DEFAULT_GREENSHED_CHECK_INTERVAL).toBe(25);
    expect(greenshedCheckInterval()).toBe(25);
  });

  it('uses the saved server setting', () => {
    process.env['GREENSHED_CHECK_INTERVAL'] = '50';
    expect(greenshedCheckInterval()).toBe(50);
  });

  it('falls back to 25 for a value that could never schedule a check', () => {
    for (const value of ['0', '-5', '2.5', 'abc', '', '10001']) {
      process.env['GREENSHED_CHECK_INTERVAL'] = value;
      expect(greenshedCheckInterval()).toBe(25);
    }
  });
});
