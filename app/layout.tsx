import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CTRL+SAFE — Can I share this to AI?",
  description:
    "Ask whether it's safe to share information with AI tools. Answers grounded in NIST AI 600-1 and the Australian OAIC's AI guidance, with page citations.",
  openGraph: {
    title: "CTRL+SAFE — Can I share this to AI?",
    description:
      "A RAG chatbot grounded in NIST AI 600-1 and OAIC guidance. Ask before you paste.",
    url: "https://ctrl-safe-zeta.vercel.app",
    siteName: "CTRL+SAFE",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#10203A",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
