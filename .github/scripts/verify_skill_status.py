#!/usr/bin/env python3
"""Publish the verify-skill commit status from trusted PR verification records.

Copied from Unson-LLC/harness runbooks/runner-fill/bin/verify_skill_status.py at 62b4fb2.
Keep the decision logic identical to that copy.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

FIELDS = {'repository', 'pr', 'head', 'skill', 'result', 'evidence'}
TRUSTED = {'OWNER', 'MEMBER', 'COLLABORATOR'}


def https_url(value):
    try:
        url = urllib.parse.urlsplit(value)
        return (url.scheme == 'https' and bool(url.hostname) and
                not url.username and not url.password and not any(c.isspace() for c in value))
    except ValueError:
        return False


def verification_record(repository, number, head, pr, comments, trusted):
    """Return the last matching trusted record; malformed current records fail closed."""
    last = None
    for source in [pr, *comments]:
        if not any(line.startswith('RUNNER_VERIFY ')
                   for line in (source.get('body') or '').splitlines()):
            continue
        if not trusted(source):
            continue
        for line in (source.get('body') or '').splitlines():
            if not line.startswith('RUNNER_VERIFY '):
                continue
            parts = line.split()[1:]
            record = dict(p.split('=', 1) for p in parts if '=' in p)
            # Ignore explicitly different identities, but never hide a damaged current record.
            if any(key in record and record[key] != value for key, value in
                   (('repository', repository), ('pr', str(number)), ('head', head))):
                continue
            last = (record, len(parts) == len(record) and all('=' in p for p in parts))
    return last


# publish() always passes the repository-permission predicate; the default supports offline callers such as the verification skill and tests.
def decide(repository, number, pr, comments,
           trusted=lambda source: source.get('author_association') in TRUSTED):
    """Pure decision: return (status state, short reason, evidence URL or None)."""
    head = pr.get('head', {}).get('sha', '')
    if not re.fullmatch(r'[0-9a-fA-F]{40}', head):
        return 'failure', 'Malformed PR head SHA', None
    last = verification_record(repository, number, head, pr, comments, trusted)
    if last is None:
        return 'failure', 'No trusted RUNNER_VERIFY record for this PR head', None
    record, valid = last
    if not valid or set(record) != FIELDS or any(not v for v in record.values()):
        return 'failure', 'Malformed RUNNER_VERIFY fields', None
    if not re.fullmatch(r'(?!/)(?!.*(?:^|/)\.\.(?:/|@))[^\s@]+@[0-9a-fA-F]{7,40}', record['skill']):
        return 'failure', 'Malformed verification skill path@commit', None
    if not https_url(record['evidence']):
        return 'failure', 'Verification evidence must be an https URL', None
    if record['result'] != 'PASS':
        return 'failure', 'RUNNER_VERIFY result is not PASS', None
    return 'success', 'Trusted verification passed for this PR head', record['evidence']


def api(path, token, payload=None):
    request = urllib.request.Request('https://api.github.com/' + path,
        data=None if payload is None else json.dumps(payload).encode(), headers={
            'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json', 'User-Agent': 'harness-verify-skill'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def comments_for(repository, number, token):
    comments = []
    page = 1
    while True:
        rows = api(f'repos/{repository}/issues/{number}/comments?per_page=100&page={page}', token)
        comments.extend(rows)
        if len(rows) < 100:
            return comments
        page += 1


class HTTPSOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not https_url(newurl):
            raise ValueError('Non-HTTPS evidence redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def readable_evidence(url, repository, token):
    try:
        if not https_url(url):
            return False
        parsed = urllib.parse.urlsplit(url)
        if parsed.hostname.lower() == 'github.com':
            prefix = '/' + repository + '/'
            if (parsed.netloc.lower() != 'github.com' or parsed.query or
                    not parsed.path.lower().startswith(prefix.lower())):
                return False
            path = parsed.path[len(prefix):]
            comment = re.fullmatch(r'(?:pull|issues)/[1-9][0-9]*', path)
            fragment = re.fullmatch(r'issuecomment-([1-9][0-9]*)', parsed.fragment)
            run = re.fullmatch(r'actions/runs/([1-9][0-9]*)(?:/(?:job|attempts)/[1-9][0-9]*)?', path)
            blob = re.fullmatch(r'blob/([0-9a-fA-F]{40})/(.+)', path)
            pull = re.fullmatch(r'pull/([1-9][0-9]*)', path)
            if comment and fragment:
                endpoint = f'issues/comments/{fragment[1]}'
            elif parsed.fragment:
                return False
            elif run:
                endpoint = f'actions/runs/{run[1]}'
            elif blob:
                content_path = urllib.parse.unquote(blob[2])
                if any(part in ('', '.', '..') for part in content_path.split('/')):
                    return False
                endpoint = f'contents/{urllib.parse.quote(content_path)}?ref={blob[1]}'
            elif pull:
                endpoint = f'pulls/{pull[1]}'
            else:
                return False
            api(f'repos/{repository}/{endpoint}', token)
            return True
        # Anonymous HTTPS requests never receive the token, including on redirects.
        with urllib.request.build_opener(HTTPSOnly()).open(url, timeout=30) as response:
            return bool(response.read(1))
    except Exception:
        return False


def publish(repository, number, token):
    pr = api(f'repos/{repository}/pulls/{number}', token)
    head = pr['head']['sha']
    if not re.fullmatch(r'[0-9a-fA-F]{40}', head):
        raise ValueError('Invalid head')
    permissions = {}

    def trusted(source):
        login = (source.get('user') or {}).get('login')
        if not isinstance(login, str) or not re.fullmatch(r'[A-Za-z0-9-]+(\[bot\])?', login):
            return False
        if login not in permissions:
            try:
                permission = api(f'repos/{repository}/collaborators/'
                                 f'{urllib.parse.quote(login, safe="")}/permission', token)
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
                permissions[login] = False
                return False
            permissions[login] = (permission['role_name'] in {'admin', 'maintain', 'write'}
                                  if 'role_name' in permission else
                                  permission.get('permission') in {'admin', 'write'})
        return permissions[login]

    try:
        comments = comments_for(repository, number, token)
        state, reason, evidence = decide(repository, number, pr, comments, trusted=trusted)
        if state == 'success' and not readable_evidence(evidence, repository, token):
            state, reason = 'failure', 'Verification evidence is unreadable'
    except Exception:
        state, reason = 'failure', 'Unable to read verification records'
    api(f'repos/{repository}/statuses/{head}', token,
        {'state': state, 'context': 'verify-skill', 'description': reason[:140]})
    print(f'verify-skill: {state}: {reason}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository')
    parser.add_argument('pr', type=int)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repository) or args.pr <= 0:
        parser.error('Expected owner/repository and positive PR number')
    try:
        publish(args.repository, args.pr, os.environ['GITHUB_TOKEN'])
    except Exception:
        print('Unable to fetch PR or post verify-skill status', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
