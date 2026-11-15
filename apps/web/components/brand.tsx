import { brandCss, type Brand } from "@garden/services";
import { LogoMark } from "@/components/ui";

/**
 * Pages a business's own customers see (public forms) wear the business's brand: its colours, and its logo instead of our mark.
 * Renders nothing extra when the business hasn't chosen colours. Only validated hex colours ever reach the style tag.
 */
export function BrandStyle({ brand }: { brand: Brand }) {
  const css = brandCss(brand);
  return css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null;
}

export function BrandMark({ brand, className = "size-12" }: { brand: Brand; className?: string }) {
  if (brand.logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={brand.logo} alt="" className={`${className} object-contain`} />;
  }
  return <LogoMark className={`${className} text-brand-800`} />;
}
