import type { IncomingHttpHeaders } from 'node:http';

import { createLog } from 'odgn-helpers/log';
import * as z from 'zod';

import { ORPCError, os as os2, os } from '@orpc/server';

const log = createLog('orpc-router');

const PlanetSchema = z.object({
  id: z.number().int().min(1),
  name: z.string(),
  description: z.string().optional()
});
type Planet = z.infer<typeof PlanetSchema>;

const planets: Planet[] = [
  {
    id: 1,
    name: 'Mercury',
    description: 'The first planet in our solar system'
  },
  {
    id: 2,
    name: 'Venus',
    description: 'The second planet in our solar system'
  },
  { id: 3, name: 'Earth', description: 'The third planet in our solar system' },
  { id: 4, name: 'Mars', description: 'The fourth planet in our solar system' },
  {
    id: 5,
    name: 'Jupiter',
    description: 'The fifth planet in our solar system'
  },
  {
    id: 6,
    name: 'Saturn',
    description: 'The sixth planet in our solar system'
  },
  {
    id: 7,
    name: 'Uranus',
    description: 'The seventh planet in our solar system'
  },
  {
    id: 8,
    name: 'Neptune',
    description: 'The eighth planet in our solar system'
  }
];

export const listPlanet = os
  .route({ method: 'GET', path: '/planets' })
  .input(
    z.object({
      limit: z.coerce.number().int().min(1).max(planets.length).optional(),
      cursor: z.coerce.number().int().min(0).max(planets.length).default(0)
    })
  )
  .output(z.array(PlanetSchema))
  .handler(async ({ input }) => {
    const cursor = input.cursor ?? 1;
    const limit = input.limit ?? 10;
    const start = cursor * limit;
    const end = start + limit;
    const planetsToReturn = planets.slice(start, end);
    // your list code here
    return planetsToReturn;
  });

export const findPlanet = os
  .route({ method: 'GET', path: '/planets/{id}' })
  .input(z.object({ id: z.coerce.number().int().min(1) }))
  .output(PlanetSchema)
  .handler(async ({ input }) => {
    // your find code here
    return planets.find(planet => planet.id === input.id);
  });

export const createPlanet = os
  .$context<{ headers: IncomingHttpHeaders }>()
  .use(({ context, next }) => {
    // const user = parseJWT(context.headers.authorization?.split(' ')[1]);

    // if (user) {
    //   return next({ context: { user } });
    // }

    throw new ORPCError('UNAUTHORIZED');
  })
  .route({ method: 'POST', path: '/planets' })
  .input(PlanetSchema.omit({ id: true }))
  .output(PlanetSchema)
  .handler(async ({ input, context }) => {
    // your create code here
    return { id: 1, name: 'Mercury' };
  });

export const router = {
  planet: {
    list: listPlanet,
    find: findPlanet,
    create: createPlanet
  }
};
