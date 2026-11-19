export type Role = "owner" | "admin" | "reviewer";

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: Role | null;
}

export interface StyleConfig {
  hook_color: string;
  keyword_color: string;
  body_color: string;
  cta_color: string;
  background: "video" | "photo";
  background_hint: string;
  voice: "female" | "male";
  voice_rate: string;
  duration: number;
  show_logo: boolean;
  logo_path: string | null;
  dim: number;
}

export interface Style {
  id: string;
  name: string;
  config: StyleConfig;
}

export interface Page {
  id: string;
  fb_page_id: string;
  name: string;
  picture_url: string | null;
  followers: number | null;
  enabled: boolean;
  categories: string[];
  clips_per_day: number;
  post_window_start: string;
  post_window_end: string;
  style_id: string | null;
  require_approval: boolean;
}

export type PostStatus =
  | "pending" | "scheduled" | "notified" | "awaiting_approval" | "posting"
  | "posted" | "failed" | "cancelled" | "delete_requested" | "deleted";

export interface ClipPost {
  id: string;
  clip_id: string;
  page_id: string;
  caption: string | null;
  scheduled_at: string;
  status: PostStatus;
  fb_video_id: string | null;
  posted_at: string | null;
  error: string | null;
  pages?: { name: string } | null;
}

export interface Clip {
  id: string;
  category: string;
  topic: string | null;
  source_url: string | null;
  source_title: string | null;
  status: "planned" | "producing" | "ready" | "failed" | "cancelled";
  video_path: string | null;
  thumb_path: string | null;
  duration_sec: number | null;
  error: string | null;
  script: { hook?: string; keyword?: string } | null;
  created_at: string;
  clip_posts: ClipPost[];
}

export const OPEN_STATUSES: PostStatus[] = ["pending", "scheduled", "notified", "awaiting_approval", "posting"];
