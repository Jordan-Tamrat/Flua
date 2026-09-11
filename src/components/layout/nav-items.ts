import {
  BookOpen,
  GraduationCap,
  Home,
  Library,
  LineChart,
  MessageCircle,
  Mic,
  PenLine,
  Settings,
  type LucideIcon,
} from "lucide-react";

/**
 * Navigation model.
 *
 * Shared between the desktop sidebar and the mobile bottom bar so the two can
 * never drift apart. `mobile: true` marks the handful of destinations that fit
 * in a bottom bar.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  mobile?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/learn",
    label: "Today",
    icon: Home,
    description: "Your dashboard and today's plan",
    mobile: true,
  },
  // Voice is the product's centrepiece, so it sits directly below the dashboard
  // and keeps a place in the mobile bar.
  {
    href: "/speaking",
    label: "Talk",
    icon: Mic,
    description: "Have a real spoken conversation",
    mobile: true,
  },
  {
    href: "/conversation",
    label: "Chat",
    icon: MessageCircle,
    description: "Practise by typing instead",
    mobile: true,
  },
  {
    href: "/teacher",
    label: "Teacher",
    icon: GraduationCap,
    description: "Ask anything about English",
  },
  {
    href: "/grammar",
    label: "Grammar",
    icon: BookOpen,
    description: "Lessons and targeted practice",
  },
  {
    href: "/vocabulary",
    label: "Vocabulary",
    icon: Library,
    description: "Save and review words",
    mobile: true,
  },
  {
    href: "/writing",
    label: "Writing",
    icon: PenLine,
    description: "Get feedback on what you write",
  },
  {
    href: "/progress",
    label: "Progress",
    icon: LineChart,
    description: "How you're getting on",
    mobile: true,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    description: "Preferences and goals",
  },
];

export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((item) => item.mobile);
