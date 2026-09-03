import type { ReactNode } from "react";

export const metadata = {
  robots: { index: false },
  title: "Solid KYB Showcase residue vocabulary (kyb)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
