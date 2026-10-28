/** Browser UI preview only: there is no network to pin (fake backend). */
export type PinningStatus = 'enabled' | 'not_configured' | 'unavailable';

export function enableCertificatePinning(): Promise<PinningStatus> {
  return Promise.resolve('unavailable');
}
