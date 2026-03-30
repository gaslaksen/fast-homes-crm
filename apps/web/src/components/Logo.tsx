interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

const sizes = {
  sm: { icon: 24, text: 'text-base' },
  md: { icon: 32, text: 'text-xl' },
  lg: { icon: 40, text: 'text-3xl' },
};

export default function Logo({ size = 'md', showText = true, className = '' }: LogoProps) {
  const { icon, text } = sizes[size];

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Hexagon */}
        <path
          d="M20 2L36.66 11.5V30.5L20 40L3.34 30.5V11.5L20 2Z"
          className="fill-primary-600 dark:fill-primary-400"
        />
        {/* D letterform */}
        <path
          d="M14 12H22C27.52 12 32 16.48 32 22C32 27.52 27.52 32 22 32H14V12ZM18.5 16.5V27.5H22C25 27.5 27.5 25 27.5 22C27.5 19 25 16.5 22 16.5H18.5Z"
          fill="white"
        />
      </svg>
      {showText && (
        <span className={`font-bold tracking-tight ${text} text-gray-900 dark:text-gray-100`}>
          <span className="font-medium">deal</span>core
        </span>
      )}
    </span>
  );
}
