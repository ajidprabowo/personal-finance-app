import {
  Briefcase,
  Car,
  Coins,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Laptop,
  Plane,
  Repeat,
  ShoppingBag,
  Tag,
  TrendingUp,
  Users,
  Utensils,
  Wallet,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface CategoryIconMeta {
  key: string;
  label: string;
  icon: LucideIcon;
}

export const CATEGORY_ICON_REGISTRY: CategoryIconMeta[] = [
  { key: 'utensils', label: 'Food & Dining', icon: Utensils },
  { key: 'home', label: 'Housing', icon: Home },
  { key: 'car', label: 'Transport', icon: Car },
  { key: 'shopping-bag', label: 'Shopping', icon: ShoppingBag },
  { key: 'wifi', label: 'Internet & Tech', icon: Wifi },
  { key: 'briefcase', label: 'Work & Office', icon: Briefcase },
  { key: 'users', label: 'Family', icon: Users },
  { key: 'repeat', label: 'Subscription', icon: Repeat },
  { key: 'tag', label: 'General', icon: Tag },
  { key: 'wallet', label: 'Salary & Cash', icon: Wallet },
  { key: 'laptop', label: 'Freelance', icon: Laptop },
  { key: 'trending-up', label: 'Investment', icon: TrendingUp },
  { key: 'gift', label: 'Gift & Bonus', icon: Gift },
  { key: 'coins', label: 'Other Income', icon: Coins },
  { key: 'heart', label: 'Health', icon: Heart },
  { key: 'graduation-cap', label: 'Education', icon: GraduationCap },
  { key: 'plane', label: 'Travel', icon: Plane },
  { key: 'zap', label: 'Utilities', icon: Zap },
];

export const DEFAULT_CATEGORY_ICON_MAP: Record<string, string> = {
  cat_default_food: 'utensils',
  cat_default_housing: 'home',
  cat_default_transport: 'car',
  cat_default_shopping: 'shopping-bag',
  cat_default_internet: 'wifi',
  cat_default_office: 'briefcase',
  cat_default_family: 'users',
  cat_default_subscription: 'repeat',
  cat_default_others: 'tag',
  cat_default_salary: 'wallet',
  cat_default_freelance: 'laptop',
  cat_default_investment_income: 'trending-up',
  cat_default_bonus: 'gift',
  cat_default_other_income: 'coins',
};

const ICON_LOOKUP = new Map<string, LucideIcon>(
  CATEGORY_ICON_REGISTRY.map((item) => [item.key, item.icon])
);

export function resolveCategoryIcon(iconKey?: string, categoryId?: string): LucideIcon {
  if (iconKey && ICON_LOOKUP.has(iconKey)) {
    return ICON_LOOKUP.get(iconKey)!;
  }
  if (categoryId && DEFAULT_CATEGORY_ICON_MAP[categoryId]) {
    return ICON_LOOKUP.get(DEFAULT_CATEGORY_ICON_MAP[categoryId]) ?? Tag;
  }
  return Tag;
}
