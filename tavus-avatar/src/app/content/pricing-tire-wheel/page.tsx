import { PricingPanel } from "@/components/pricing-panel";
import { getOrderedProductKeys, getPricingConfig } from "@/lib/pricing-config";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PricingTireWheelPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const config = getPricingConfig();
  const product = config.products.tire_wheel;
  const completedRaw = params.completed;
  const completedKeys = (Array.isArray(completedRaw) ? completedRaw[0] : completedRaw)?.split(",") ?? [];

  return (
    <PricingPanel
      eyebrow={product.eyebrow}
      title={product.title}
      description={product.description}
      bullets={product.bullets}
      progress={{
        steps: getOrderedProductKeys(config).map((key) => ({ key, label: config.products[key].label })),
        completedKeys,
        currentKey: "tire_wheel",
      }}
    />
  );
}