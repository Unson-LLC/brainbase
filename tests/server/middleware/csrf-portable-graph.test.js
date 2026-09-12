import { describe, expect, it, vi } from 'vitest';
import { csrfMiddleware } from '../../../server/middleware/csrf.js';
describe('portable Graph CSRF boundary',()=>{
    it('exempts only bearer import/search routes while cookies stay protected',()=>{
        const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
        try {
            for(const [path,headers,allowed] of [
                ['/api/info/graph/portable/snapshot/import',{authorization:'Bearer token'},true],
                ['/api/info/graph/portable/snapshot/search',{authorization:'Bearer token'},true],
                ['/api/info/graph/portable/snapshot/import',{},false],
                ['/api/info/graph/portable/snapshot/delete',{authorization:'Bearer token'},false]
            ]) {
                const next=vi.fn(); const status=vi.fn(()=>({json:vi.fn()}));
                csrfMiddleware()({method:'POST',path,headers},{status},next);
                expect(next.mock.calls.length).toBe(allowed?1:0);
                if(!allowed) expect(status).toHaveBeenCalledWith(403);
            }
        } finally {process.env.NODE_ENV=previous;}
    });
});
