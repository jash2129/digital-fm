import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import { isFinanceEvent } from "@/lib/event";

import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500"],
});

const dealershipName = process.env.DEALERSHIP_NAME || "Digital Finance Manager";

export const metadata: Metadata = isFinanceEvent()
  ? {
      title: dealershipName,
      description: "F&I finance manager video consultation.",
    }
  : {
      title: "AWS Voice AI Demo",
      description: "Private AWS Voice AI booth demo with Daily React and tool-driven content overlays.",
    };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // 1. Prevent Bitdefender extension from adding bis_skin_checked attribute to DOM elements
                if (typeof Element !== 'undefined' && Element.prototype) {
                  var origSetAttribute = Element.prototype.setAttribute;
                  Element.prototype.setAttribute = function(name, value) {
                    if (name === 'bis_skin_checked') return;
                    return origSetAttribute.apply(this, arguments);
                  };
                  try {
                    Object.defineProperty(Element.prototype, 'bis_skin_checked', {
                      get: function() { return undefined; },
                      set: function() {},
                      configurable: true,
                    });
                  } catch (e) {}
                }

                // 2. Strip any bis_skin_checked attributes already in the document
                var cleanBis = function() {
                  if (typeof document === 'undefined') return;
                  var els = document.querySelectorAll('[bis_skin_checked]');
                  for (var i = 0; i < els.length; i++) {
                    els[i].removeAttribute('bis_skin_checked');
                  }
                };
                cleanBis();
                if (typeof document !== 'undefined' && document.readyState === 'loading') {
                  document.addEventListener('DOMContentLoaded', cleanBis, { once: true });
                }

                // 3. Prevent Next.js error overlay from displaying bis_skin_checked or hydration mismatch errors
                if (typeof window !== 'undefined') {
                  window.addEventListener('error', function(event) {
                    var msg = (event && event.message) || '';
                    if (
                      typeof msg === 'string' &&
                      (msg.indexOf('bis_skin_checked') !== -1 ||
                       msg.indexOf('hydration') !== -1 ||
                       msg.indexOf('Hydration') !== -1 ||
                       msg.indexOf('hydrated') !== -1)
                    ) {
                      event.preventDefault();
                      event.stopImmediatePropagation();
                    }
                  }, true);
                }

                // 4. Filter console.error and console.warn for bis_skin_checked and hydration warnings
                var filterArgs = function(args) {
                  for (var i = 0; i < args.length; i++) {
                    var item = args[i];
                    var str = '';
                    try {
                      str = typeof item === 'string' ? item : (item && item.message) || JSON.stringify(item);
                    } catch (err) {
                      str = String(item || '');
                    }
                    if (
                      str.indexOf('bis_skin_checked') !== -1 ||
                      str.indexOf('hydration') !== -1 ||
                      str.indexOf('Hydration') !== -1 ||
                      str.indexOf('hydrated') !== -1
                    ) {
                      return true;
                    }
                  }
                  return false;
                };

                var origError = console.error;
                console.error = function() {
                  if (filterArgs(arguments)) return;
                  origError.apply(console, arguments);
                };

                var origWarn = console.warn;
                console.warn = function() {
                  if (filterArgs(arguments)) return;
                  origWarn.apply(console, arguments);
                };
              })();
            `,
          }}
        />
      </head>
      <body className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} antialiased`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
