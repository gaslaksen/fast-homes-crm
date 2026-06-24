import Svg, { Path } from 'react-native-svg';
import { colors } from '@/theme';

/**
 * Dealcore hexagon logo mark — identical geometry to apps/web/public/favicon.svg.
 * Teal hexagon with a white "d" letterform.
 */
export function Logo({ size = 40, color = colors.primary }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <Path d="M20 2L36.66 11.5V30.5L20 40L3.34 30.5V11.5L20 2Z" fill={color} />
      <Path
        d="M14 12H22C27.52 12 32 16.48 32 22C32 27.52 27.52 32 22 32H14V12ZM18.5 16.5V27.5H22C25 27.5 27.5 25 27.5 22C27.5 19 25 16.5 22 16.5H18.5Z"
        fill="white"
      />
    </Svg>
  );
}
