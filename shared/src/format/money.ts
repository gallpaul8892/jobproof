const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

/** Integer pence to "£1,234.56". */
export function formatPence(pence: number): string {
  return gbp.format(pence / 100);
}
