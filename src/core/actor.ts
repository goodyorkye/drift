import os from 'node:os';
import { type ActorRef, type ActorSource } from '../types.js';

const MAX_ACTOR_NAME_LENGTH = 40;

export function normalizeActorName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_ACTOR_NAME_LENGTH) return null;
    return trimmed;
}

export function makeActor(name: unknown, source: ActorSource): ActorRef | null {
    const normalized = normalizeActorName(name);
    if (!normalized) return null;
    return { name: normalized, source };
}

export function requireActor(name: unknown, source: ActorSource): ActorRef {
    const actor = makeActor(name, source);
    if (!actor) {
        throw new Error('Missing or invalid actor name.');
    }
    return actor;
}

export function cliActor(): ActorRef {
    return {
        name: os.userInfo().username || 'local-user',
        source: 'cli',
    };
}
