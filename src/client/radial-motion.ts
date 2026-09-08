import { clampOffset, RADIAL_VISIBLE } from "./radial-scroll";

const STRETCH = .5; // At most half an option of resistance at either end.
const RESISTANCE = .45;
const DECAY = .18; // Seconds of gentle momentum, independent of refresh rate.
const SPRING = 16;

export interface RadialMotion {
  position: number;
  velocity: number; // Options per second.
  target?: number;
  done?: boolean;
}

/** Compress the finger's travel outside the list; never wrap its contents. */
export function rubberBandOffset(position: number, count: number): number {
  if (count <= RADIAL_VISIBLE) return 0;
  const edge = clampOffset(position, count);
  const excess = position - edge;
  return edge + Math.sign(excess) * STRETCH * (1 - Math.exp(-Math.abs(excess) * RESISTANCE / STRETCH));
}

/** Picking up a stretched arc must not jump when the next drag begins. */
export function dragOrigin(position: number, count: number): number {
  const edge = clampOffset(position, count);
  const excess = position - edge;
  return edge - Math.sign(excess) * Math.log(1 - Math.min(.99, Math.abs(excess) / STRETCH)) * STRETCH / RESISTANCE;
}

export function releaseMotion(position: number, velocity: number, count: number): RadialMotion {
  const edge = clampOffset(position, count);
  return {
    position,
    velocity: (position - edge) * velocity > 0 ? 0 : Math.max(-8, Math.min(8, velocity)),
    target: edge !== position ? edge : Math.abs(velocity) < .35 ? Math.round(edge) : undefined,
  };
}

/** Coast with friction, then settle onto an option using a critically damped spring. */
export function advanceMotion(motion: RadialMotion, seconds: number, count: number): RadialMotion {
  let { position, velocity, target } = motion;
  const dt = Math.min(.032, Math.max(0, seconds));
  if (target === undefined) {
    const decay = Math.exp(-dt / DECAY);
    position += velocity * DECAY * (1 - decay);
    velocity *= decay;
    const edge = clampOffset(position, count);
    if (position !== edge) target = edge;
    else if (Math.abs(velocity) < .35) target = Math.round(edge);
  } else {
    target = clampOffset(target, count);
    const displacement = position - target;
    const impulse = velocity + SPRING * displacement;
    const decay = Math.exp(-SPRING * dt);
    position = target + (displacement + impulse * dt) * decay;
    velocity = (velocity - SPRING * impulse * dt) * decay;
    if (Math.abs(position - target) < .001 && Math.abs(velocity) < .01) {
      return { position: target, velocity: 0, target, done: true };
    }
  }
  return { position, velocity, target };
}
