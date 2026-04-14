import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
        <style>{`
          body,
          button,
          input,
          select,
          textarea {
            font-family: var(--p-font-family-sans);
          }

          input,
          select,
          textarea,
          .Polaris-TextField__Input,
          .Polaris-Select__Input {
            font-size: 12px !important;
          }

          input::placeholder,
          textarea::placeholder,
          .Polaris-TextField__Input::placeholder {
            text-transform: capitalize;
          }
        `}</style>
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
