"""Safe database diagnostics without logging SQL parameters or connection secrets."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import OperationalError, ProgrammingError
from starlette.requests import Request

from app.main import database_error


@pytest.mark.parametrize('sqlstate,schema_error', [
    ('42P01', True), ('42703', True), ('08006', False), (None, False),
])
def test_database_error_preserves_503_and_redacts_sensitive_context(caplog, sqlstate, schema_error):
    class DriverFailure(Exception):
        pass

    original = DriverFailure('private-driver-error-and-credentials')
    original.sqlstate = sqlstate
    error_type = ProgrammingError if schema_error else OperationalError
    error = error_type('private SQL text', {'password': 'private-parameter'}, original)
    request = Request({'type': 'http', 'path': '/private-instance-path',
                       'route': SimpleNamespace(path='/api/v1/stenosis/analytics/summary')})
    response = asyncio.run(database_error(request, error))
    assert response.status_code == 503
    payload = json.loads(response.body)
    assert set(payload) == {'detail'}
    assert ('Alembic migrations' in payload['detail']) is schema_error
    if not schema_error:
        assert payload['detail'] == 'Database temporarily unavailable'
    assert '/api/v1/stenosis/analytics/summary' in caplog.text
    assert f'schema_error={schema_error}' in caplog.text
    for secret in ['private-driver-error-and-credentials', 'private SQL text',
                   'private-parameter', 'password', '/private-instance-path']:
        assert secret not in caplog.text and secret not in payload['detail']


@pytest.mark.parametrize('path', [
    '/api/v1/stenosis/analytics/summary',
    '/api/v1/stenosis/analytics/analyses?limit=10&offset=0',
])
def test_unmigrated_analytics_fails_honestly_and_recovers_after_upgrade(client, account, db, path):
    from alembic import command
    from alembic.config import Config

    # Only the disposable database selected by conftest is ever migrated.
    _, headers = account('Admin')
    # account() refreshes the committed user. End that read transaction before
    # PostgreSQL DDL takes locks on tables with foreign keys to users.
    db.rollback()
    command.downgrade(Config('alembic.ini'), '0005_segmentation_results')
    assert client.get('/api/v1/cases', headers=headers).status_code == 200
    assert client.get(path).status_code == 401
    failed = client.get(path, headers=headers)
    assert failed.status_code == 503
    assert 'schema is out of date or incomplete' in failed.json()['detail']
    assert 'Alembic migrations' in failed.json()['detail']
    assert set(failed.json()) == {'detail'}  # No fabricated analytics payload.

    command.upgrade(Config('alembic.ini'), 'head')
    recovered = client.get(path, headers=headers)
    assert recovered.status_code == 200, recovered.text
    data = recovered.json()
    if path.endswith('/summary'):
        assert data['jobs']['total'] == data['current']['analyses'] == 0
        assert data['severity_distribution'] is None
    else:
        assert data['total'] == 0 and data['items'] == [] and not data['has_more']
        assert data['limit'] == 10 and data['offset'] == 0
    assert recovered.headers['cache-control'] == 'no-store'
    assert client.get('/api/v1/cases', headers=headers).status_code == 200
