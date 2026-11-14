import importlib.util
import re
from pathlib import Path
import unittest
from unittest.mock import patch

PATH = Path(__file__).resolve().parent / 'verify_skill_status.py'
spec = importlib.util.spec_from_file_location('verify_skill_status', PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
REPO = 'Unson-LLC/example'
HEAD = 'a' * 40
RECORD = (f'RUNNER_VERIFY repository={REPO} pr=7 head={HEAD} '
          f'skill=verify/SKILL.md@{"b" * 40} result=PASS evidence=https://example.com/evidence')


class VerifySkillStatusTests(unittest.TestCase):
    def setUp(self):
        self.pr = {'head': {'sha': HEAD}, 'body': '', 'author_association': 'MEMBER', 'user': {'login': 'writer'}}
        self.comments = [{'body': RECORD, 'author_association': 'MEMBER', 'user': {'login': 'writer'}}]

    def decision(self):
        return m.decide(REPO, 7, self.pr, self.comments)

    def test_pass_record_succeeds(self):
        self.assertEqual(self.decision()[0], 'success')

    def test_fail_record_fails(self):
        self.comments[0]['body'] = RECORD.replace('result=PASS', 'result=FAIL')
        self.assertEqual(self.decision()[0], 'failure')

    def test_no_record_fails(self):
        self.comments = []
        self.assertEqual(self.decision()[0], 'failure')

    def test_comment_deletion_recomputes_from_current_comments(self):
        workflow = PATH.parents[1] / 'workflows' / 'verify-skill.yml'
        event = re.search(r'^  issue_comment:\n    types: \[(.*?)\]',
                          workflow.read_text(), re.MULTILINE)
        self.assertIsNotNone(event)
        self.assertEqual({item.strip() for item in event[1].split(',')},
                         {'created', 'edited', 'deleted'})
        self.assertEqual(self.decision()[0], 'success')
        self.comments.clear()
        self.assertEqual(self.decision()[0], 'failure')
        with patch.object(m, 'api', side_effect=[self.pr, [], {}]) as api, \
                patch.object(m, 'readable_evidence') as evidence, patch('builtins.print'):
            m.publish(REPO, 7, 'test-only')
            self.assertIn('/comments?', api.call_args_list[1].args[0])
            self.assertEqual(api.call_args.args[2]['state'], 'failure')
            evidence.assert_not_called()

    def test_untrusted_author_is_ignored(self):
        self.comments[0]['author_association'] = 'NONE'
        self.assertEqual(self.decision()[0], 'failure')

    def test_last_record_wins(self):
        self.pr['body'] = RECORD
        self.comments[0]['body'] = RECORD.replace('result=PASS', 'result=FAIL')
        self.assertEqual(self.decision()[0], 'failure')
        self.comments.append({'body': RECORD, 'author_association': 'OWNER'})
        self.assertEqual(self.decision()[0], 'success')

    def test_head_repository_and_pr_mismatch_fail(self):
        for record in (RECORD.replace(HEAD, 'c' * 40), RECORD.replace(REPO, 'other/repo'),
                       RECORD.replace('pr=7', 'pr=8')):
            with self.subTest(record=record):
                self.comments[0]['body'] = record
                self.assertEqual(self.decision()[0], 'failure')

    def test_malformed_fields_fail(self):
        for record in (RECORD.replace('result=PASS ', ''), RECORD + ' result=PASS',
                       RECORD.replace('skill=verify/SKILL.md@', 'skill=verify/SKILL.md'),
                       RECORD.replace('https://example.com', 'http://example.com'),
                       RECORD.replace('b' * 40, 'not-a-commit'),
                       RECORD.replace('https://example.com', 'https://'),
                       RECORD.replace('result=PASS', 'result='), RECORD + ' garbage'):
            with self.subTest(record=record):
                self.comments[0]['body'] = record
                self.assertEqual(self.decision()[0], 'failure')

    def test_later_malformed_record_does_not_reuse_pass(self):
        self.comments.append({'body': RECORD.replace('result=PASS ', ''), 'author_association': 'MEMBER'})
        self.assertEqual(self.decision()[0], 'failure')

    def test_publish_posts_status_to_same_head(self):
        for result in ('PASS', 'FAIL'):
            with self.subTest(result=result), patch.object(m, 'api') as api, \
                    patch.object(m, 'readable_evidence', return_value=True), patch('builtins.print'):
                api.side_effect = [self.pr, [{'body': RECORD.replace('PASS', result), 'author_association': 'MEMBER',
                              'user': {'login': 'writer'}}], {'role_name': 'write'}, {}]
                m.publish(REPO, 7, 'test-only')
                path, token, payload = api.call_args.args
                self.assertEqual(path, f'repos/{REPO}/statuses/{HEAD}')
                self.assertEqual(payload['context'], 'verify-skill')
                self.assertEqual(payload['state'], 'success' if result == 'PASS' else 'failure')
                self.assertLessEqual(len(payload['description']), 140)

    def publish_with_permission(self, permission, comments=None):
        with patch.object(m, 'api', side_effect=[
                self.pr, self.comments if comments is None else comments, permission, {}]) as api, \
                patch.object(m, 'readable_evidence', return_value=True), patch('builtins.print'):
            m.publish(REPO, 7, 'test-only')
        return api

    def test_private_member_pr_author_with_write_permission_succeeds(self):
        self.pr.update(body=RECORD, author_association='CONTRIBUTOR')
        api = self.publish_with_permission({'role_name': 'write'}, comments=[])
        self.assertEqual(api.call_args.args[2]['state'], 'success')

    def test_permission_roles_and_fallback(self):
        for permission, expected in (({'role_name': 'read'}, 'failure'),
                                     ({'role_name': 'none'}, 'failure'),
                                     ({'role_name': 'maintain'}, 'success'),
                                     ({'role_name': 'admin'}, 'success'),
                                     ({'permission': 'write'}, 'success'),
                                     ({'permission': 'admin'}, 'success'),
                                     ({'permission': 'read'}, 'failure'),
                                     ({'role_name': 'read', 'permission': 'admin'}, 'failure')):
            with self.subTest(permission=permission):
                api = self.publish_with_permission(permission)
                payload = api.call_args.args[2]
                self.assertEqual(payload['state'], expected)
                if expected == 'failure':
                    self.assertEqual(payload['description'],
                                     'No trusted RUNNER_VERIFY record for this PR head')

    def test_permission_errors_post_failure(self):
        for error in (m.urllib.error.HTTPError('https://example.com', 500, 'error', {}, None),
                      OSError('HTTP 404'), TimeoutError(),
                      m.json.JSONDecodeError('malformed JSON', '', 0)):
            with self.subTest(error=error):
                api = self.publish_with_permission(error)
                self.assertEqual(api.call_args.args[2]['state'], 'failure')
                self.assertEqual(api.call_args.args[2]['description'],
                                 'Unable to read verification records')

    def test_404_poster_is_ignored_while_writer_pass_succeeds(self):
        missing = {'body': RECORD, 'user': {'login': 'missing[bot]'}}
        error = m.urllib.error.HTTPError('https://example.com', 404, 'missing', {}, None)
        for comments, expected in (([missing], 'failure'),
                                   ([missing, self.comments[0], missing], 'success')):
            with self.subTest(expected=expected), patch.object(m, 'api') as api, \
                    patch.object(m, 'readable_evidence', return_value=True), patch('builtins.print'):
                if expected == 'success':
                    api.side_effect = [self.pr, comments, error, {'role_name': 'write'}, {}]
                else:
                    api.side_effect = [self.pr, comments, error, {}]
                m.publish(REPO, 7, 'test-only')
                self.assertEqual(api.call_args.args[2]['state'], expected)
                lookups = [call.args[0] for call in api.call_args_list
                           if '/collaborators/' in call.args[0]]
                self.assertEqual(lookups.count(
                    f'repos/{REPO}/collaborators/missing%5Bbot%5D/permission'), 1)

    def test_later_writer_fail_overrides_pass(self):
        self.pr['body'] = RECORD
        self.comments[0]['body'] = RECORD.replace('result=PASS', 'result=FAIL')
        api = self.publish_with_permission({'role_name': 'write'})
        self.assertEqual(api.call_args.args[2]['state'], 'failure')
        self.assertEqual(api.call_args.args[2]['description'], 'RUNNER_VERIFY result is not PASS')

    def test_permission_lookup_quotes_and_caches_login(self):
        self.pr.update(body=RECORD, user={'login': 'runner[bot]'})
        self.comments[0]['user'] = {'login': 'runner[bot]'}
        api = self.publish_with_permission({'role_name': 'write'})
        self.assertEqual(api.call_args_list[2].args,
                         (f'repos/{REPO}/collaborators/runner%5Bbot%5D/permission', 'test-only'))
        self.assertEqual(len(api.call_args_list), 4)
        self.assertEqual(api.call_args.args[2]['state'], 'success')

    def test_invalid_login_never_looked_up(self):
        for login in ('../writer', 'writer/name', 'writer?admin', '', None, 7):
            with self.subTest(login=login):
                self.comments[0]['user'] = {'login': login}
                with patch.object(m, 'api', side_effect=[self.pr, self.comments, {}]) as api, \
                        patch('builtins.print'):
                    m.publish(REPO, 7, 'test-only')
                self.assertEqual(len(api.call_args_list), 3)
                self.assertEqual(api.call_args.args[2]['state'], 'failure')

    def test_sources_without_record_never_looked_up(self):
        self.pr.update(body='ordinary text', user={'login': 'unrelated'})
        api = self.publish_with_permission({'role_name': 'write'})
        self.assertEqual(api.call_args_list[2].args[0],
                         f'repos/{REPO}/collaborators/writer/permission')
        self.assertEqual(len(api.call_args_list), 4)

    def test_unreadable_evidence_posts_failure(self):
        with patch.object(m, 'api', side_effect=[self.pr, self.comments, {'role_name': 'write'}, {}]) as api, \
                patch.object(m, 'readable_evidence', return_value=False), patch('builtins.print'):
            m.publish(REPO, 7, 'test-only')
            self.assertEqual(api.call_args.args[2]['state'], 'failure')

    def test_posting_failure_propagates(self):
        with patch.object(m, 'api', side_effect=[self.pr, [], OSError]):
            with self.assertRaises(OSError):
                m.publish(REPO, 7, 'test-only')

    def test_each_missing_field_fails(self):
        for field in m.FIELDS:
            with self.subTest(field=field):
                self.comments[0]['body'] = ' '.join(
                    part for part in RECORD.split() if not part.startswith(field + '='))
                self.assertEqual(self.decision()[0], 'failure')

    def test_job_succeeds_after_failure_status_and_fails_on_post_error(self):
        with patch('sys.argv', ['verify_skill_status.py', REPO, '7']), \
                patch.dict(m.os.environ, {'GITHUB_TOKEN': 'test-only'}), \
                patch.object(m, 'api', side_effect=[self.pr, [], {}]), patch('builtins.print'):
            self.assertEqual(m.main(), 0)
        with patch('sys.argv', ['verify_skill_status.py', REPO, '7']), \
                patch.dict(m.os.environ, {'GITHUB_TOKEN': 'test-only'}), \
                patch.object(m, 'api', side_effect=[self.pr, [], OSError]), patch('builtins.print'):
            self.assertEqual(m.main(), 1)

    def test_unreadable_comments_post_failure_status(self):
        with patch.object(m, 'api', side_effect=[self.pr, OSError, {}]) as api, patch('builtins.print'):
            m.publish(REPO, 7, 'test-only')
            self.assertEqual(api.call_args.args[2]['state'], 'failure')

    def test_evidence_request_does_not_receive_token(self):
        with patch.object(m, 'api') as api, patch.object(m.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value = b'x'
            self.assertTrue(m.readable_evidence('https://example.com/evidence', REPO, 'test-only'))
            opener.return_value.open.assert_called_once_with('https://example.com/evidence', timeout=30)
            api.assert_not_called()

    def check_github_evidence(self, suffix, endpoint):
        with patch.object(m, 'api', return_value={}) as api, \
                patch.object(m.urllib.request, 'build_opener') as opener:
            self.assertTrue(m.readable_evidence(f'https://github.com/{REPO}/{suffix}', REPO, 'test-only'))
            api.assert_called_once_with(f'repos/{REPO}/{endpoint}', 'test-only')
            opener.assert_not_called()

    def test_github_pull_comment_evidence(self):
        self.check_github_evidence('pull/7#issuecomment-123', 'issues/comments/123')

    def test_github_issue_comment_evidence(self):
        self.check_github_evidence('issues/7#issuecomment-123', 'issues/comments/123')

    def test_github_run_evidence(self):
        self.check_github_evidence('actions/runs/123', 'actions/runs/123')

    def test_github_run_job_evidence(self):
        self.check_github_evidence('actions/runs/123/job/456', 'actions/runs/123')

    def test_github_run_attempt_evidence(self):
        self.check_github_evidence('actions/runs/123/attempts/2', 'actions/runs/123')

    def test_github_blob_evidence(self):
        self.check_github_evidence(f'blob/{HEAD}/docs/proof.md', f'contents/docs/proof.md?ref={HEAD}')

    def test_github_pull_evidence(self):
        self.check_github_evidence('pull/7', 'pulls/7')

    def test_github_other_repository_refused(self):
        with patch.object(m, 'api') as api, patch.object(m.urllib.request, 'build_opener') as opener:
            self.assertFalse(m.readable_evidence('https://github.com/other/repo/pull/7', REPO, 'test-only'))
            api.assert_not_called()
            opener.assert_not_called()

    def test_github_unknown_form_refused(self):
        for suffix in ('issues/7', 'tree/main', 'pull/7/files', 'blob/main/proof.md',
                       'pull/7#discussion_r123', 'actions/runs/123?other=1'):
            with self.subTest(suffix=suffix), patch.object(m, 'api') as api, \
                    patch.object(m.urllib.request, 'build_opener') as opener:
                self.assertFalse(m.readable_evidence(f'https://github.com/{REPO}/{suffix}', REPO, 'test-only'))
                api.assert_not_called()
                opener.assert_not_called()

    def test_github_api_failure_is_unreadable(self):
        with patch.object(m, 'api', side_effect=OSError), \
                patch.object(m.urllib.request, 'build_opener') as opener:
            self.assertFalse(m.readable_evidence(f'https://github.com/{REPO}/pull/7', REPO, 'test-only'))
            opener.assert_not_called()

    def test_evidence_redirect_to_http_refuses(self):
        with self.assertRaises(ValueError):
            m.HTTPSOnly().redirect_request(None, None, 302, '', {}, 'http://example.com')

    def test_comments_read_all_pages(self):
        with patch.object(m, 'api', side_effect=[[self.comments[0]] * 100, self.comments]) as api:
            self.assertEqual(len(m.comments_for(REPO, 7, 'test-only')), 101)
            self.assertIn('page=2', api.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
