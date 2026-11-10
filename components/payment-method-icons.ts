import {
  ArrowRightLeft,
  Banknote,
  Barcode,
  CreditCard,
  QrCode,
} from "lucide-react";

export const paymentMethodIcons = {
  pix: QrCode,
  cash: Banknote,
  credit_card: CreditCard,
  debit_card: CreditCard,
  bank_slip: Barcode,
  transfer: ArrowRightLeft,
  other: Banknote,
};
