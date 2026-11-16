export type Intensity = "subtle" | "balanced" | "immersive";
export type CreatedBy = "user" | "assistant";

/** Fields an agent needs to choose an avatar. Projected from a full avatar. */
export interface AvatarSummary {
  id: string;
  name: string;
  description: string;
  useWhen: string[];
}

export interface AvatarSummaryList {
  items: AvatarSummary[];
}

/**
 * Body of POST /avatars. Optional fields match the service defaults:
 * ignores and useWhen empty, intensity balanced, createdBy user.
 */
export interface AvatarCreate {
  name: string;
  description: string;
  perspective: string;
  voice: string;
  caresAbout: string[];
  ignores?: string[];
  useWhen?: string[];
  intensity?: Intensity;
  createdBy?: CreatedBy;
}

/** A stored avatar, as the avatar service returns it. */
export interface Avatar {
  id: string;
  name: string;
  description: string;
  perspective: string;
  voice: string;
  caresAbout: string[];
  ignores: string[];
  useWhen: string[];
  intensity: Intensity;
  createdBy: CreatedBy;
  createdAt: string;
  updatedAt: string;
}
