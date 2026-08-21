-- The Lifeweb's two player-facing Requests: bleeding someone for the pool,
-- and feeding someone to it. See docs/systemdocs/REQUESTS.md.
ALTER TYPE "RequestType" ADD VALUE 'DONATE_BLOOD';
ALTER TYPE "RequestType" ADD VALUE 'FEED_PERSON';
