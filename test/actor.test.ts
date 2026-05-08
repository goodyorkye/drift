import { describe, expect, it } from 'vitest';
import { makeActor, requireActor } from '../src/core/actor.js';

describe('actor helpers', () => {
    it('normalizes a short declared actor name', () => {
        expect(makeActor('  York  ', 'web')).toEqual({ name: 'York', source: 'web' });
    });

    it('rejects missing or oversized actor names', () => {
        expect(makeActor('', 'web')).toBeNull();
        expect(makeActor('x'.repeat(41), 'web')).toBeNull();
        expect(() => requireActor('', 'web')).toThrow('Missing or invalid actor name.');
    });
});
