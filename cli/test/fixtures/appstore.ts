// The structure of apps.apple.com's embedded data as of November 2026, with made-up app details.
export type Opts = { trader?: "yes" | "no" | "none"; address?: string; price?: number; iap?: boolean; privacy?: { type: string; cats: string[] }[]; policy?: string | null; links?: string[] };
export function appStorePage(o: Opts = {}): string {
  const text = (rawText: string, type = "text/plain") => ({ $kind: "linkableText", linkableText: { $kind: "LinkableText", styledText: { $kind: "StyledText", rawText, rawTextType: type } } });
  const provider =
    o.trader === "none"
      ? []
      : [
          {
            $kind: "Annotation",
            title: "Provider",
            summary: "Example Apps GmbH",
            items:
              o.trader === "no"
                ? [text("Example Apps GmbH has not identified itself as a trader for this app. If you are a consumer in the European Economic Area, consumer rights do not apply to agreements between you and the provider.")]
                : [
                    text("Example Apps GmbH has identified itself as a trader for this app and confirmed that this product or service complies with European Union law."),
                    { $kind: "spacer" },
                    text(`**Address**\n${o.address ?? "Musterstr. 1\n10115 Berlin\nGermany"}`, "text/markdown"),
                    { $kind: "spacer" },
                    text("**Phone Number**\n+49 30 1234567", "text/markdown"),
                    { $kind: "spacer" },
                    text("**Email**\nhello@example.com", "text/markdown"),
                  ],
          },
        ];
  const data = {
    data: [
      {
        data: {
          title: "Example Notes",
          canonicalURL: "https://apps.apple.com/de/app/example-notes/id1234567890?l=en-GB",
          shelfMapping: {
            description: { items: [{ developerLinks: (o.links ?? ["https://example.com/", "https://example.com/support"]).map((url) => ({ clickAction: { url } })) }] },
            privacyHeader: { items: [{ bodyText: { linkedSubstrings: o.policy === null ? {} : { "developer's privacy policy": { url: o.policy ?? "https://example.com/privacy" } } } }] },
            privacyTypes: { items: (o.privacy ?? [{ type: "DATA_NOT_COLLECTED", cats: [] }]).map((p) => ({ $kind: "PrivacyType", identifier: p.type, categories: p.cats.map((c) => ({ identifier: c })) })) },
            information: { items: [{ title: "Size", items: [] }, ...(o.iap ? [{ title: "In-App Purchases", items: [] }] : []), ...provider] },
          },
        },
      },
    ],
  };
  const ld = { "@type": "SoftwareApplication", name: "Example Notes", author: { name: "Example Apps GmbH" }, offers: { "@type": "Offer", price: o.price ?? 0, priceCurrency: "EUR" } };
  return `<html><script type="application/ld+json">${JSON.stringify(ld)}</script><script type="application/json" id="serialized-server-data">${JSON.stringify(data)}</script></html>`;
}

