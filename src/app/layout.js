import "./globals.css";

export const metadata = {
  title: "Recovery Intelligence — Convin × RBL Bank",
  description:
    "AI collections performance: how much credit-card outstanding Convin's AI voice agents recovered for RBL Bank — recovery, call telemetry, compliance and intelligence.",

  robots: { index: false, follow: false, nocache: true },
};

const FINISH_INIT = `try{localStorage.removeItem('cvtheme');if(localStorage.getItem('cvfinish')!=='light'){document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <head>
        {}
        <meta name="color-scheme" content="dark light" />
        <script dangerouslySetInnerHTML={{ __html: FINISH_INIT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
