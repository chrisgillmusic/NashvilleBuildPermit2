import './globals.css';
import 'leaflet/dist/leaflet.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BidHammer',
  description: 'Fast, action-focused permit jobs for subcontractors.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
