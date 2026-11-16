import { zAvatar, zCreatedBy, zIntensity, zProblem } from "@avatars/contracts/avatar/zod";
import type { z } from "zod";

export type Avatar = z.output<typeof zAvatar>;
export type CreatedBy = z.output<typeof zCreatedBy>;
export type Intensity = z.output<typeof zIntensity>;
export type Problem = z.output<typeof zProblem>;
