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
  Target,
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
  // Sits next to the two conversation modes because it is what turns a
  // conversation into something learned rather than just something said.
  {
    href: "/practice",
    label: "Fix-ups",
    icon: Target,
    description: "Re-do sentences you got wrong",
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
  // Off the mobile bar to keep it to five: fix-ups earn the slot more, since
  // they come from conversations the learner has actually had.
  {
    href: "/vocabulary",
    label: "Vocabulary",
    icon: Library,
    description: "Save and review words",
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
