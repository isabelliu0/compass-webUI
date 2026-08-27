// Source: openapi.json (published by the physicaltab policy server).
// Regenerate: npm run codegen

/**
 * Steering-camera geometry. Constant for a run (the waist is fixed during
 * manipulation), so a client reads it once and projects locally.
 */
export interface Camera {
  name: string;
  width: number;
  height: number;
  /** 3x3 intrinsics at native resolution */
  K: number[][];
  /** 4x4 pelvis -> camera optical frame */
  T_pelvis_in_optical: number[][];
}

/** One entry in the menu offered at a decision point. */
export interface ModeOption {
  /** rank; 0 is dominant and the default on timeout */
  id: number;
  /** samples that landed in this cluster (dominance) */
  count: number;
  trajectory: Trajectory;
  /** row of `trajectory` where this mode's own next decision point lands */
  outcome_index: number;
  /** RGB 0-255, stable per mode id */
  color: number[];
}

/** Static description of this server. Read once at connect. */
export interface OperatorInfo {
  api_version: string;
  arms: number;
  arm_order: string[];
  /** reference frame of every 3D point ('pelvis') */
  frame: string;
  position_units: string;
  time_units: string;
  fps: number;
  mode_menu_enabled: boolean;
  mode_follow_enabled: boolean;
  /**
   * seconds the operator gets at a decision point before the server auto-resumes
   * on the selected mode. 0 = no hold.
   */
  decide_timeout_s: number;
  camera: Camera | null;
}

/** Everything the operator client needs, in one snapshot. */
export interface OperatorState {
  phase: Phase;
  /** identifies the current menu; echo it back on select */
  menu_epoch: number;
  menu_ready: boolean;
  decide_remaining_s: number | null;
  selected_mode_id: number;
  mode_follow_active: boolean;
  /** [arm] -> [x,y,z] finger-centre now, pelvis frame, metres */
  current_ee: number[][];
  current_plan: Trajectory;
  modes: ModeOption[];
}

export interface PauseRequest {
  paused: boolean;
}

export interface PauseResponse {
  ok: boolean;
  phase: Phase;
}

/**
 * What the robot is doing, from the operator's point of view. IDLE no
 * observations yet (the robot client has not started streaming). RUNNING
 * executing the chosen mode; no decision pending. DECIDING held at a decision
 * point: a menu is offered and the timeout is running. On expiry the server
 * auto-resumes with whatever mode is selected (mode 0 unless the operator
 * picked another), so this is a soft deadline rather than a blocking prompt.
 * PAUSED held by the operator; stays held until ``set_paused(False)``.
 */
export type Phase = "idle" | "running" | "deciding" | "paused";

export interface SelectRequest {
  mode_id: number;
  /**
   * the menu_epoch this pick was made against; a mismatch is rejected as stale
   * rather than applied to a newer menu
   */
  menu_epoch: number;
}

export interface SelectResponse {
  ok: boolean;
  status: SelectStatus;
  selected_mode_id: number;
  menu_epoch: number;
  n_modes: number;
}

/** Outcome of ``select_mode``. */
export type SelectStatus = "ok" | "stale_epoch" | "out_of_range" | "no_menu" | "menu_not_ready" | "disabled";

/** A future path through space, one polyline per arm (left, right). */
export interface Trajectory {
  /** [arm][row] -> [x,y,z] finger-centre, pelvis frame, metres */
  points: number[][][];
  /**
   * [row] -> seconds from now. NOT uniformly spaced: the policy predicts on a
   * multi-resolution grid, so interpolate on this rather than assuming a fixed
   * step.
   */
  times: number[];
}
