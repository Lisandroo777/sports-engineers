import Image from 'next/image';

interface DeepSideLogoProps {
  className?: string;
  priority?: boolean;
  alt?: string;
}

export function DeepSideLogo({
  className = '',
  priority = false,
  alt = 'DeepSide logo',
}: DeepSideLogoProps) {
  return (
    <Image
      src="/branding/deepside-logo.png"
      alt={alt}
      width={1600}
      height={900}
      priority={priority}
      className={className}
    />
  );
}
