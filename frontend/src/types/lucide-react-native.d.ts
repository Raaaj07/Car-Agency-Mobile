import 'lucide-react-native';

declare module 'lucide-react-native' {
  import { ComponentType } from 'react';
  import { SvgProps } from 'react-native-svg';

  export interface LucideProps extends SvgProps {
    size?: number | string;
    color?: string;
    fill?: string;
    strokeWidth?: number | string;
    absoluteStrokeWidth?: boolean;
    style?: any;
  }

  export type Icon = ComponentType<LucideProps>;
}
