import Providers from "./providers";
import Navbar from "@/components/Navbar";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Suppress noisy MetaMask / extension unhandled rejections from triggering the Next.js dev error overlay */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined') {
                window.addEventListener('unhandledrejection', function(e) {
                  var msg = (e.reason && (e.reason.message || String(e.reason))) || '';
                  if (
                    msg.indexOf('MetaMask') !== -1 ||
                    msg.indexOf('Receiving end does not exist') !== -1 ||
                    msg.indexOf('Extension context invalidated') !== -1
                  ) {
                    e.preventDefault();
                  }
                });
              }
            `,
          }}
        />
      </head>
      <body>
        <Providers>
          <Navbar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
