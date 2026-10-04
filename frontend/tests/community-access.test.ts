import { describe, expect, it } from 'vitest'
import { accessFor, canWriteInSelectedCommunity, relationToZev, shellRoleFor, shellRoleForZev } from '../src/lib/communityAccess'
import { communityEntries, resolveCommunitySelection } from '../src/lib/managedZev'
import { relationOf, ownParticipantIds } from '../src/lib/membership'
import type { Membership, User, Zev } from '../src/types/api'

// What the shell shows for the selected community (#761, SPEC-2026-10-zev-access-grants §9).

const row = (live: boolean) => ({ id: `p-${live}`, valid_from: '2026-01-01', valid_to: live ? null : '2026-03-31', live })
const membership = (zev: string, over: Partial<Membership> = {}): Membership => ({
    zev,
    zev_name: zev.toUpperCase(),
    zev_disabled: false,
    access: null,
    participants: [],
    ...over,
})
const user = (over: Partial<User> = {}): User => ({
    id: 7,
    username: 'u',
    email: 'u@example.com',
    first_name: 'U',
    last_name: 'Ser',
    role: 'user',
    must_change_password: false,
    preferred_zev: null,
    ...over,
})

describe('relationOf', () => {
    it('is the grant first, then a current participant row, else former', () => {
        expect(relationOf(membership('a', { access: 'viewer', participants: [row(true)] }))).toBe('viewer')
        expect(relationOf(membership('a', { participants: [row(false), row(true)] }))).toBe('participant')
        expect(relationOf(membership('a', { participants: [row(false)] }))).toBe('former')
    })
})

describe('shellRoleFor', () => {
    it('is admin for an admin whatever the relation', () => {
        expect(shellRoleFor(user({ role: 'admin' }), 'participant')).toBe('admin')
    })

    it('follows the relation to the selected community', () => {
        expect(shellRoleFor(user(), 'manager')).toBe('manager')
        expect(shellRoleFor(user(), 'participant')).toBe('participant')
    })

    it('is none without a relation', () => {
        expect(shellRoleFor(user())).toBe('none')
        expect(shellRoleFor(null)).toBe('none')
    })
})

describe('accessFor', () => {
    it('lets a viewer read the management view but not write', () => {
        expect(accessFor('viewer')).toMatchObject({ isZevScope: true, canManage: false, isParticipantScope: false })
    })

    it('lets a manager and an admin write', () => {
        expect(accessFor('manager').canManage).toBe(true)
        expect(accessFor('admin')).toMatchObject({ canManage: true, isAdmin: true })
    })

    it('keeps canManage as role capability: it does not consider a disabled community', () => {
        expect(accessFor('manager')).toMatchObject({ canManage: true, canWriteSelectedCommunity: true })
    })

    it('gives participants and former participants the participant view', () => {
        expect(accessFor('participant')).toMatchObject({ isZevScope: false, isParticipantScope: true })
        expect(accessFor('former')).toMatchObject({ isZevScope: false, isParticipantScope: true })
        expect(accessFor('none')).toMatchObject({ isZevScope: false, canManage: false, isParticipantScope: false })
    })
})

describe('canWriteInSelectedCommunity', () => {
    const manager = accessFor('manager')
    const viewer = accessFor('viewer')
    const admin = accessFor('admin')

    it('allows a manager on an active community', () => {
        expect(canWriteInSelectedCommunity(manager, { disabled_at: null })).toBe(true)
    })

    it('is not writable for a manager without a resolved community record', () => {
        expect(canWriteInSelectedCommunity(manager, null)).toBe(false)
        expect(canWriteInSelectedCommunity(manager, undefined)).toBe(false)
    })

    it('keeps a manager readable but not writable on a disabled community', () => {
        expect(canWriteInSelectedCommunity(manager, { disabled_at: '2026-01-01T00:00:00Z' })).toBe(false)
    })

    it('lets an admin still write to a disabled community', () => {
        expect(canWriteInSelectedCommunity(admin, { disabled_at: '2026-01-01T00:00:00Z' })).toBe(true)
    })

    it('never lets a viewer write', () => {
        expect(canWriteInSelectedCommunity(viewer, { disabled_at: null })).toBe(false)
        expect(canWriteInSelectedCommunity(viewer, { disabled_at: '2026-01-01T00:00:00Z' })).toBe(false)
    })
})

describe('ownParticipantIds', () => {
    it('collects participant rows across communities, including ended ones', () => {
        const someone = user({ memberships: [
            membership('a', { access: 'manager' }),
            membership('b', { participants: [row(true)] }),
            membership('c', { participants: [row(false)] }),
        ] })
        expect([...ownParticipantIds(someone)].sort()).toEqual(['p-false', 'p-true'])
        expect(ownParticipantIds(null).size).toBe(0)
    })
})
describe('relationToZev', () => {
    const someone = user({ memberships: [membership('a', { access: 'manager' }), membership('b', { participants: [row(true)] })] })

    it('answers for the record’s own community, not the selected one', () => {
        expect(relationToZev(someone, 'a')).toBe('manager')
        expect(relationToZev(someone, 'b')).toBe('participant')
        expect(relationToZev(someone, 'c')).toBeUndefined()
        expect(shellRoleForZev(someone, 'b')).toBe('participant')
    })
})

describe('communityEntries', () => {
    const zevs = [{ id: 'a', name: 'Alpha', owner: 7 }, { id: 'z', name: 'Zeta', owner: 9 }] as Zev[]

    it('lists every ZEV for an admin', () => {
        expect(communityEntries(user({ role: 'admin' }), zevs).map((entry) => [entry.id, entry.relation])).toEqual([
            ['a', 'admin'], ['z', 'admin'],
        ])
    })

    it('lists the memberships, each with its relation', () => {
        const someone = user({ memberships: [membership('a', { access: 'viewer' }), membership('b', { participants: [row(false)] })] })
        expect(communityEntries(someone, zevs).map((entry) => [entry.id, entry.relation])).toEqual([
            ['a', 'viewer'], ['b', 'former'],
        ])
    })

    it('lists nothing for an account without memberships', () => {
        expect(communityEntries(user(), zevs)).toEqual([])
    })
})

describe('resolveCommunitySelection', () => {
    it('keeps an explicit pick, then the preference, then the first entry', () => {
        expect(resolveCommunitySelection({ isAdmin: false, entryIds: ['a', 'b'], currentId: 'b' }).selection).toBe('b')
        expect(resolveCommunitySelection({ isAdmin: false, entryIds: ['a', 'b'], currentId: 'x', preferredZevId: 'b' }).selection).toBe('b')
        expect(resolveCommunitySelection({ isAdmin: false, entryIds: ['a', 'b'], currentId: '' }).selection).toBe('a')
        expect(resolveCommunitySelection({ isAdmin: false, entryIds: [], currentId: '' }).selection).toBe('')
    })

    it('lets anyone with more than one community switch, an admin always', () => {
        expect(resolveCommunitySelection({ isAdmin: false, entryIds: ['a'], currentId: '' }).isSelectable).toBe(false)
        expect(resolveCommunitySelection({ isAdmin: false, entryIds: ['a', 'b'], currentId: '' }).isSelectable).toBe(true)
        expect(resolveCommunitySelection({ isAdmin: true, entryIds: ['a'], currentId: '' }).isSelectable).toBe(true)
        const selection = resolveCommunitySelection({ isAdmin: false, entryIds: ['a', 'b'], currentId: '' })
        expect(selection.isAllowedId('b')).toBe(true)
        expect(selection.isAllowedId('x')).toBe(false)
    })
})
