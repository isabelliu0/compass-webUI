// GENERATED - do not edit by hand.
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

/** What the operator is being asked about. */
export interface Decision {
  kind: DecisionKind;
  /**
   * arm indices this decision is about (0 left, 1 right). Empty means it
   * concerns both hands together -- draw the pair rather than one endpoint. For
   * a gripper event this is the hand actually opening or closing, the only
   * endpoint worth marking.
   */
  hands: number[];
}

/**
 * Why the robot stopped to ask. INITIAL the episode-start decision point.
 * GRIPPER a hand is about to grasp or release. INTER_HAND the inter-hand
 * transform T_LR changed coordination regime. Only the ``--seg-method regime``
 * segmenter can detect this. STATIC both arms went still and are about to move
 * again. Under ``--seg-method gripper-static`` this is what stands in for an
 * inter-hand event -- it occupies the same slot in the state machine but is
 * not a T_LR regime change, so it is named for what it is. NONE no boundary at
 * all. Only appears as a mode's ``outcome``: the segmenter found nothing
 * inside that chunk, so the marker is just the end of the preview rather than
 * a decision point.
 */
export type DecisionKind = "initial" | "gripper" | "inter_hand" | "static" | "none";

/** One entry in the menu offered at a decision point. */
export interface ModeOption {
  /** rank; 0 is dominant and the default on timeout */
  id: number;
  /** samples that landed in this cluster (dominance) */
  count: number;
  trajectory: Trajectory;
  /** row of `trajectory` where this mode's own next decision point lands */
  outcome_index: number;
  /**
   * what will be asked at `outcome_index`. The marker sits there, so this -- not
   * `State.decision` -- is what decides how to draw it. `State.decision` is the
   * boundary holding the robot right now; this is the one this mode leads to,
   * and modes can differ.
   */
  outcome: Decision;
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
   * seconds at a decision point before the server auto-resumes. null = untimed:
   * the robot holds until a mode is selected, which is the go-ahead. 0 = no hold
   * at all (the menu just refreshes).
   */
  decide_timeout_s: number | null;
  /**
   * gripper width below this counts as closed; the same threshold the server
   * uses to fire grasp/release decision points
   */
  grip_closed_below: number;
  camera: Camera | null;
}

/** Everything the operator client needs, in one snapshot. */
export interface OperatorState {
  phase: Phase;
  /**
   * what the menu currently on offer is about. Stays populated after the hold
   * ends, because the menu itself stays selectable until the next boundary
   * replaces it. Null only before the first decision point of an episode.
   */
  decision?: Decision | null;
  /** identifies the current menu; echo it back on select */
  menu_epoch: number;
  menu_ready: boolean;
  decide_remaining_s: number | null;
  selected_mode_id: number;
  mode_follow_active: boolean;
  /** [arm] -> [x,y,z] finger-centre now, pelvis frame, metres */
  current_ee: number[][];
  /** [arm] -> measured gripper width now, in [0,1] */
  current_grip?: number[];
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
 * observations yet (the robot client isn't streaming). INITIAL_PAUSE held at
 * the episode-start decision point, before any motion. EXECUTING rolling out
 * the chosen mode; no decision pending. PAUSE_GRIPPER_EVENT held at a
 * grasp/release decision point. ``State.decision.hands`` says which hand is
 * acting, so a client can mark just that one. PAUSE_IHTF_EVENT held at a
 * decision point about the pair rather than one hand. ``State.decision.kind``
 * says which detector fired -- only the ``regime`` segmenter produces true
 * inter-hand-transform events. PAUSED held by the operator; stays held until
 * ``set_paused(False)``. The three PAUSE_/INITIAL_ states are all decision
 * holds and all carry a menu; they differ only in what the operator is being
 * asked about.
 */
export type Phase = "idle" | "initial_pause" | "executing" | "pause_gripper_event" | "pause_ihtf_event" | "paused";

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
  /**
   * [arm][row] -> gripper width in [0,1] (0 closed, 1 open), on the same rows as
   * `points`. Style the path by hand state; compare against `grip_closed_below`
   * from /operator/info.
   */
  grip?: number[][];
}
