/** `GET /api/quota`, signed in only. The counts are what the account and the network have left today. */
export interface Quota {
  readonly remainingAccount: number;
  readonly remainingIp: number;
  readonly limitAccount: number;
  readonly limitIp: number;
}
