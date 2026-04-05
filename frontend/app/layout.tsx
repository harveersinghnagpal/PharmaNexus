import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import ShellProvider from "@/components/ShellProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PharmaNexus — Enterprise Pharmacy Operations Platform",
  description: "Omnichannel enterprise pharmacy operations: real-time inventory, POS billing, BI analytics, AI insights, prescription management, and offline-capable workflows.",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <ShellProvider>
            {children}
          </ShellProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
