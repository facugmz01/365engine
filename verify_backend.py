import asyncio
import sys
import os
import unittest
from unittest.mock import MagicMock, patch, AsyncMock
from datetime import datetime, timezone
import uuid
import httpx
from pydantic import ValidationError
from sqlalchemy import select

# Add the workspace path so imports like 'app.models' resolve correctly
sys.path.insert(0, os.path.abspath("c:/intune_export"))

# Core components imports
from app.core.config import settings
from app.core.security import encryptor, CredentialEncryptor
from app.models import Base, Organization, AppCredential, ConfigurationTemplate, DeploymentJob, DeploymentStatus
from app.schemas import (
    OrganizationCreate, OrganizationRead,
    AppCredentialCreate, AppCredentialRead,
    ConfigurationTemplateCreate, ConfigurationTemplateRead,
    DeploymentJobCreate, DeploymentJobRead,
    TemplateImportRequest, GroupDefinition, TemplateAssignment
)
from app.services import (
    auth_agent, GraphAuthAgent, InvalidCredentialsException, TokenAcquisitionException,
    GraphAPIClient, GraphAPIException, GraphAPIThrottledException, GraphAPIRequestException
)
from app.main import app
from app.tasks import celery_app, run_deployment_job, run_import_templates
from app.database.init_tables import seed_baseline_templates

# Check optional dependencies
try:
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    HAS_SQLALCHEMY_TEST_DEPS = True
except ImportError:
    HAS_SQLALCHEMY_TEST_DEPS = False

try:
    from fastapi.testclient import TestClient
    HAS_TEST_CLIENT = True
except ImportError:
    HAS_TEST_CLIENT = False


class TestSecurityEncryption(unittest.TestCase):
    def test_encryption_decryption(self):
        plain_secret = "my-super-secret-entra-key-12345!"
        encrypted = encryptor.encrypt(plain_secret)
        self.assertNotEqual(plain_secret, encrypted)
        decrypted = encryptor.decrypt(encrypted)
        self.assertEqual(plain_secret, decrypted)


class TestPydanticSchemas(unittest.TestCase):
    def test_template_schemas(self):
        template_data = {
            "name": "Firewall Rule Template",
            "description": "Block inbound requests on port 80",
            "category": "defender",
            "endpoint": "deviceManagement/configurationPolicies",
            "payload": {"rules": [{"port": 80, "action": "block"}]}
        }
        create_schema = ConfigurationTemplateCreate(**template_data)
        self.assertEqual(create_schema.name, "Firewall Rule Template")

    def test_group_definition_validation(self):
        # 1. Valid static group
        g1 = GroupDefinition(display_name="Static Group", group_type="static")
        self.assertEqual(g1.group_type, "static")
        self.assertIsNone(g1.membership_rule)

        # 2. Valid dynamic group with membership rule
        g2 = GroupDefinition(
            display_name="Dynamic Devices",
            group_type="dynamic",
            membership_rule="device.devicePhysicalIds -any (_ -contains \"[ZTDId]\")"
        )
        self.assertEqual(g2.group_type, "dynamic")
        self.assertIsNotNone(g2.membership_rule)

        # 3. Invalid dynamic group (missing membership rule)
        with self.assertRaises(ValidationError):
            GroupDefinition(display_name="Dynamic Invalid", group_type="dynamic")

        # 4. Invalid group type
        with self.assertRaises(ValidationError):
            GroupDefinition(display_name="Invalid Type", group_type="hybrid")


class TestAuthAgentCaching(unittest.IsolatedAsyncioTestCase):
    @patch("msal.ConfidentialClientApplication")
    async def test_token_acquisition_and_caching(self, mock_cc_app):
        mock_instance = MagicMock()
        mock_cc_app.return_value = mock_instance
        mock_instance.acquire_token_for_client.return_value = {
            "access_token": "mock-token-abc-123",
            "expires_in": 3600
        }

        agent = GraphAuthAgent(token_expiry_buffer=60)
        token1 = await agent.get_access_token("t1", "c1", "s1")
        self.assertEqual(token1, "mock-token-abc-123")


class TestGraphAPIClient(unittest.IsolatedAsyncioTestCase):
    @patch("httpx.AsyncClient.request")
    async def test_pagination_aggregation(self, mock_request):
        mock_resp_1 = MagicMock(spec=httpx.Response)
        mock_resp_1.status_code = 200
        mock_resp_1.is_error = False
        mock_resp_1.json.return_value = {
            "value": [{"id": 1, "name": "Policy1"}],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations?skip=1"
        }

        mock_resp_2 = MagicMock(spec=httpx.Response)
        mock_resp_2.status_code = 200
        mock_resp_2.is_error = False
        mock_resp_2.json.return_value = {
            "value": [{"id": 2, "name": "Policy2"}]
        }

        mock_request.side_effect = [mock_resp_1, mock_resp_2]

        client = GraphAPIClient(access_token="fake-token")
        result = await client.get_resource("deviceManagement/deviceConfigurations")
        self.assertEqual(len(result["value"]), 2)


class TestSQLAlchemyModelsMapping(unittest.IsolatedAsyncioTestCase):
    async def test_relational_mappings(self):
        if not HAS_SQLALCHEMY_TEST_DEPS:
            self.skipTest("Missing async SQLAlchemy dependencies for database mapping tests.")

        engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        async with async_session() as session:
            org = Organization(name="Target Tenant", tenant_id="target-tenant-uuid")
            session.add(org)
            await session.commit()

            template = ConfigurationTemplate(
                name="Firewall Profile",
                description="Secure firewall rules baseline",
                category="defender",
                endpoint="deviceManagement/configurationPolicies",
                payload={"enabled": True}
            )
            session.add(template)
            await session.commit()

            job = DeploymentJob(
                organization_id=org.id,
                status=DeploymentStatus.PENDING,
                parameters={"assignment_target": "unassigned"}
            )
            job.templates.append(template)
            session.add(job)
            await session.commit()

            from sqlalchemy.orm import selectinload
            stmt = select(Organization).where(Organization.id == org.id).options(selectinload(Organization.deployment_jobs))
            res = await session.execute(stmt)
            result = res.scalar_one()
            self.assertEqual(result.deployment_jobs[0].parameters["assignment_target"], "unassigned")

            await session.close()
        await engine.dispose()


class TestFastAPIEndpoints(unittest.TestCase):
    @patch("app.tasks.run_deployment_job.delay")
    def test_start_deployment_endpoint_with_groups(self, mock_celery_delay):
        if not HAS_TEST_CLIENT:
            self.skipTest("fastapi.testclient missing. Skipping API tests.")

        mock_session = AsyncMock()

        target_org_id = uuid.uuid4()
        template_id = uuid.uuid4()
        
        mock_org = Organization(id=target_org_id, name="Target", tenant_id="tgt-tenant")
        mock_template = ConfigurationTemplate(id=template_id, name="Template", category="fw", endpoint="deviceManagement/configurationPolicies", payload={})

        mock_session.execute = AsyncMock()
        
        first_execute_result = MagicMock()
        first_execute_result.scalar_one_or_none.return_value = mock_org

        second_execute_result = MagicMock()
        second_execute_result.scalars.return_value.all.return_value = [mock_template]

        mock_session.execute.side_effect = [first_execute_result, second_execute_result]

        from app.database.connection import get_db_session
        from app.main import get_current_user
        async def override_db():
            yield mock_session
            
        from app.models.user import User, UserRole
        mock_user = User(id=uuid.uuid4(), username="admin", role=UserRole.SUPER_ADMIN, is_active=True)
        async def override_user():
            return mock_user
            
        app.dependency_overrides[get_db_session] = override_db
        app.dependency_overrides[get_current_user] = override_user

        try:
            client = TestClient(app)
            payload = {
                "organization_id": str(target_org_id),
                "template_ids": [str(template_id)],
                "create_groups": [
                    {"display_name": "SG-Test-Static", "group_type": "static"},
                    {"display_name": "SG-Test-Dynamic", "group_type": "dynamic", "membership_rule": "device.deviceId -ne null"}
                ],
                "assignment_target": "custom_groups",
                "assign_to_groups": ["SG-Test-Static", "SG-Test-Dynamic"],
                "template_assignments": [
                    {
                        "template_id": str(template_id),
                        "assignment_target": "custom_groups",
                        "assign_to_groups": ["SG-Test-Static"]
                    }
                ]
            }
            
            response = client.post("/api/v1/deployments/start", json=payload)
            
            self.assertEqual(response.status_code, 202)
            json_resp = response.json()
            self.assertIn("job_id", json_resp)
            self.assertEqual(json_resp["status"], "pending")
            mock_celery_delay.assert_called_once_with(json_resp["job_id"])
        finally:
            app.dependency_overrides.clear()

    @patch("app.tasks.run_tcm_snapshot_import.delay")
    def test_import_tcm_endpoint(self, mock_celery_delay):
        if not HAS_TEST_CLIENT:
            self.skipTest("fastapi.testclient missing. Skipping API tests.")

        mock_session = AsyncMock()
        target_org_id = uuid.uuid4()
        mock_org = Organization(id=target_org_id, name="Source Org", tenant_id="src-tenant")
        mock_org.credentials = [AppCredential(client_id="cid", client_secret="csec")]

        mock_session.execute = AsyncMock()
        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = mock_org
        mock_session.execute.return_value = mock_execute_result

        from app.database.connection import get_db_session
        from app.main import get_current_user
        
        async def override_db():
            yield mock_session
            
        from app.models.user import User, UserRole
        mock_user = User(id=uuid.uuid4(), username="admin", role=UserRole.SUPER_ADMIN, is_active=True)
        async def override_user():
            return mock_user
            
        app.dependency_overrides[get_db_session] = override_db
        app.dependency_overrides[get_current_user] = override_user

        try:
            client = TestClient(app)
            payload = {
                "organization_id": str(target_org_id),
                "workloads": ["entra", "intune"]
            }
            
            response = client.post("/api/v1/templates/import-tcm", json=payload)
            self.assertEqual(response.status_code, 202)
            json_resp = response.json()
            self.assertIn("message", json_resp)
            self.assertEqual(json_resp["organization_name"], "Source Org")
            mock_celery_delay.assert_called_once_with(str(target_org_id), ["entra", "intune"])
        finally:
            app.dependency_overrides.clear()

    @patch("app.services.snapshot_agent.fetch_tcm_snapshot", new_callable=AsyncMock)
    def test_fetch_snapshot_endpoint(self, mock_fetch):
        if not HAS_TEST_CLIENT:
            self.skipTest("fastapi.testclient missing. Skipping API tests.")

        mock_fetch.return_value = [{"id": "test_res", "name": "Test Resource"}]

        mock_session = AsyncMock()
        target_org_id = uuid.uuid4()
        mock_org = Organization(id=target_org_id, name="Source Org", tenant_id="src-tenant")
        mock_org.credentials = [AppCredential(client_id="cid", client_secret="csec")]

        mock_session.execute = AsyncMock()
        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = mock_org
        mock_session.execute.return_value = mock_execute_result

        from app.database.connection import get_db_session
        from app.main import get_current_user
        
        async def override_db():
            yield mock_session
            
        from app.models.user import User, UserRole
        mock_user = User(id=uuid.uuid4(), username="admin", role=UserRole.SUPER_ADMIN, is_active=True)
        async def override_user():
            return mock_user
            
        app.dependency_overrides[get_db_session] = override_db
        app.dependency_overrides[get_current_user] = override_user

        try:
            client = TestClient(app)
            payload = {
                "organization_id": str(target_org_id),
                "workloads": ["entra"]
            }
            
            with patch("app.services.auth_agent.auth_agent.get_access_token", new_callable=AsyncMock) as mock_get_token:
                mock_get_token.return_value = "fake-token"
                response = client.post("/api/v1/snapshots/fetch", json=payload)
                self.assertEqual(response.status_code, 200)
                json_resp = response.json()
                self.assertIn("data", json_resp)
                self.assertEqual(len(json_resp["data"]), 1)
                self.assertEqual(json_resp["data"][0]["name"], "Test Resource")
        finally:
            app.dependency_overrides.clear()

    def test_admin_login_endpoint(self):
        if not HAS_TEST_CLIENT:
            self.skipTest("fastapi.testclient missing. Skipping API tests.")

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock()
        
        mock_execute_result = MagicMock()
        from app.models.user import User, UserRole
        import uuid
        mock_user = User(id=uuid.uuid4(), username="admin", password_hash="fakehash", role=UserRole.SUPER_ADMIN, is_active=True)
        mock_execute_result.scalar_one_or_none.return_value = mock_user
        mock_session.execute.return_value = mock_execute_result
        
        from app.database.connection import get_db_session
        async def override_db():
            yield mock_session
            
        app.dependency_overrides[get_db_session] = override_db

        with patch("app.core.security.verify_password", return_value=True):
            try:
                client = TestClient(app)
                # 1. Invalid login (we'll mock verify_password to return False for wrong_password)
                with patch("app.core.security.verify_password", return_value=False):
                    response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrong_password"})
                    self.assertEqual(response.status_code, 401)
                
                # 2. Valid login
                response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin_password_123!"})
                self.assertEqual(response.status_code, 200)
                data = response.json()
                self.assertIn("access_token", data)
                self.assertEqual(data["token_type"], "bearer")
            finally:
                app.dependency_overrides.clear()

    def test_protected_routes_require_authentication(self):
        if not HAS_TEST_CLIENT:
            self.skipTest("fastapi.testclient missing. Skipping API tests.")

        client = TestClient(app)
        
        # 1. Access without token -> Should fail with 401
        response = client.get("/api/v1/organizations")
        self.assertEqual(response.status_code, 401)
        
        # 2. Access with token -> Should pass authentication
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock()
        
        from app.models.user import User, UserRole
        import uuid
        mock_user = User(id=uuid.uuid4(), username="admin", password_hash="fakehash", role=UserRole.SUPER_ADMIN, is_active=True)
        
        # We need the execute to return the user on login, user on auth check, and then empty list on organizations
        mock_execute_result_login = MagicMock()
        mock_execute_result_login.scalar_one_or_none.return_value = mock_user
        
        mock_execute_result_orgs = MagicMock()
        mock_execute_result_orgs.scalars.return_value.all.return_value = []
        
        mock_session.execute.side_effect = [mock_execute_result_login, mock_execute_result_login, mock_execute_result_orgs]
        
        from app.database.connection import get_db_session
        async def override_db():
            yield mock_session
        app.dependency_overrides[get_db_session] = override_db

        with patch("app.core.security.verify_password", return_value=True):
            try:
                # Login first to get token
                login_resp = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin_password_123!"})
                token = login_resp.json()["access_token"]
                
                headers = {"Authorization": f"Bearer {token}"}
                response = client.get("/api/v1/organizations", headers=headers)
                self.assertEqual(response.status_code, 200)
            finally:
                app.dependency_overrides.clear()


class TestCeleryTasks(unittest.IsolatedAsyncioTestCase):
    @patch("app.tasks.async_session_maker")
    @patch("app.tasks.auth_agent.get_access_token")
    @patch("app.tasks.GraphAPIClient")
    async def test_async_run_deployment_with_granular_assignments(self, mock_client_cls, mock_get_token, mock_session_maker):
        # Setup mocks
        mock_session = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_session

        mock_get_token.return_value = "mock-token"
        mock_client = AsyncMock()
        mock_client_cls.return_value = mock_client

        # Mock database select query response
        job_id = uuid.uuid4()
        org_id = uuid.uuid4()
        template_id_1 = uuid.uuid4()
        template_id_2 = uuid.uuid4()

        mock_org = Organization(id=org_id, name="Test Org", tenant_id="test-tenant")
        mock_org.credentials = [AppCredential(client_id="cid", client_secret="csec")]

        mock_t1 = ConfigurationTemplate(
            id=template_id_1,
            name="Template 1",
            category="defender",
            endpoint="deviceManagement/configurationPolicies",
            payload={"foo": "bar"}
        )
        mock_t2 = ConfigurationTemplate(
            id=template_id_2,
            name="Template 2",
            category="defender",
            endpoint="deviceManagement/configurationPolicies",
            payload={"baz": "qux"}
        )

        mock_job = DeploymentJob(
            id=job_id,
            organization_id=org_id,
            status=DeploymentStatus.PENDING,
            parameters={
                "bypass_validation": True,
                "create_groups": [
                    {"display_name": "SG-Custom-1", "group_type": "static"},
                ],
                "assignment_target": "unassigned",
                "template_assignments": [
                    {
                        "template_id": str(template_id_1),
                        "assignment_target": "custom_groups",
                        "assign_to_groups": ["SG-Custom-1"]
                    },
                    {
                        "template_id": str(template_id_2),
                        "assignment_target": "unassigned"
                    }
                ]
            }
        )
        mock_job.organization = mock_org
        mock_job.templates = [mock_t1, mock_t2]

        # Execute mock setup
        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = mock_job
        mock_session.execute.return_value = mock_execute_result

        # Graph API responses
        # 1. Resolve or create group (returns group_id)
        mock_client.get_resource.side_effect = [
            # Group search for SG-Custom-1 (not found)
            {"value": []},
        ]
        mock_client.post_resource.side_effect = [
            # Create group SG-Custom-1
            {"id": "new-group-id-123"},
            # Create policy Template 1
            {"id": "policy-id-1"},
            # Assign policy Template 1
            {"status": "ok"},
            # Create policy Template 2
            {"id": "policy-id-2"},
        ]

        from app.tasks import async_run_deployment
        await async_run_deployment(job_id)

        # Assertions
        # 1. Access token was retrieved
        mock_get_token.assert_called_once()
        
        # 2. Both templates were posted to Graph API
        mock_client.post_resource.assert_any_call(endpoint="deviceManagement/configurationPolicies", payload={"foo": "bar"})
        mock_client.post_resource.assert_any_call(endpoint="deviceManagement/configurationPolicies", payload={"baz": "qux"})

        # 3. Only Template 1 (which had assignment target 'custom_groups') was assigned to the resolved group
        mock_client.post_resource.assert_any_call(
            "deviceManagement/configurationPolicies/policy-id-1/assign",
            {
                "assignments": [
                    {
                        "target": {
                            "@odata.type": "#microsoft.graph.groupAssignmentTarget",
                            "groupId": "new-group-id-123"
                        }
                    }
                ]
            }
        )
        
        # Template 2 has 'unassigned' so there should be no assign call for it
        for call_args in mock_client.post_resource.call_args_list:
            if len(call_args[0]) > 0:
                endpoint = call_args[0][0]
                self.assertNotIn("policy-id-2/assign", endpoint)

    @patch("app.tasks.async_session_maker")
    @patch("app.tasks.auth_agent.get_access_token")
    @patch("app.tasks.GraphAPIClient")
    async def test_async_run_deployment_failed_validation(self, mock_client_cls, mock_get_token, mock_session_maker):
        # Mocks
        mock_session = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        mock_get_token.return_value = "mock-token"
        mock_client = AsyncMock()
        mock_client_cls.return_value = mock_client

        # Job setup
        job_id = uuid.uuid4()
        org_id = uuid.uuid4()
        mock_org = Organization(id=org_id, name="Test Org", tenant_id="test-tenant")
        mock_org.credentials = [AppCredential(client_id="cid", client_secret="csec")]
        
        mock_job = DeploymentJob(
            id=job_id,
            organization_id=org_id,
            status=DeploymentStatus.PENDING,
            parameters={"bypass_validation": False}
        )
        mock_job.organization = mock_org
        mock_job.templates = []

        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = mock_job
        mock_session.execute.return_value = mock_execute_result

        # Validation API responses: no compatible licenses found
        mock_client.get_resource.side_effect = [
            {"value": []}, # subscribedSkus
        ]

        from app.tasks import async_run_deployment
        await async_run_deployment(job_id)

        # Assert status was set to FAILED due to validation error
        self.assertEqual(mock_job.status, DeploymentStatus.FAILED)
        self.assertIn("validation_results", mock_job.parameters)
        self.assertFalse(mock_job.parameters["validation_results"]["valid"])

    @patch("app.tasks.async_session_maker")
    @patch("app.tasks.auth_agent.get_access_token")
    @patch("app.tasks.GraphAPIClient")
    async def test_async_run_deployment_automatic_rollback_on_error(self, mock_client_cls, mock_get_token, mock_session_maker):
        # Mocks
        mock_session = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        mock_get_token.return_value = "mock-token"
        mock_client = AsyncMock()
        mock_client_cls.return_value = mock_client

        # Job setup
        job_id = uuid.uuid4()
        org_id = uuid.uuid4()
        mock_org = Organization(id=org_id, name="Test Org", tenant_id="test-tenant")
        mock_org.credentials = [AppCredential(client_id="cid", client_secret="csec")]
        mock_template = ConfigurationTemplate(
            id=uuid.uuid4(),
            name="Template 1",
            category="defender",
            endpoint="deviceManagement/configurationPolicies",
            payload={"foo": "bar"}
        )
        
        mock_job = DeploymentJob(
            id=job_id,
            organization_id=org_id,
            status=DeploymentStatus.PENDING,
            parameters={"bypass_validation": True}  # Bypass so we hit creation error
        )
        mock_job.organization = mock_org
        mock_job.templates = [mock_template]

        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = mock_job
        mock_session.execute.return_value = mock_execute_result

        # Graph API responses: Policy creation throws exception
        mock_client.post_resource.side_effect = Exception("Graph API Error")

        from app.tasks import async_run_deployment
        await async_run_deployment(job_id)

        # Assertions: Job fails
        self.assertEqual(mock_job.status, DeploymentStatus.FAILED)

    @patch("app.tasks.async_session_maker")
    @patch("app.tasks.auth_agent.get_access_token")
    @patch("app.tasks.GraphAPIClient")
    async def test_async_run_rollback_manual(self, mock_client_cls, mock_get_token, mock_session_maker):
        # Mocks
        mock_session = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        mock_get_token.return_value = "mock-token"
        mock_client = AsyncMock()
        mock_client_cls.return_value = mock_client

        # Job setup
        job_id = uuid.uuid4()
        org_id = uuid.uuid4()
        mock_org = Organization(id=org_id, name="Test Org", tenant_id="test-tenant")
        mock_org.credentials = [AppCredential(client_id="cid", client_secret="csec")]
        
        mock_job = DeploymentJob(
            id=job_id,
            organization_id=org_id,
            status=DeploymentStatus.COMPLETED,
            parameters={
                "deployed_resources": [
                    {"id": "policy-123", "endpoint": "deviceManagement/configurationPolicies"}
                ],
                "created_groups_resolved": ["group-999"]
            }
        )
        mock_job.organization = mock_org

        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = mock_job
        mock_session.execute.return_value = mock_execute_result

        from app.tasks import async_run_rollback
        await async_run_rollback(job_id)

        # Assert both resource and group were deleted
        mock_client.delete_resource.assert_any_call("deviceManagement/configurationPolicies/policy-123")
        mock_client.delete_resource.assert_any_call("groups/group-999")
        
        # Verify params are cleared
        self.assertEqual(mock_job.parameters["deployed_resources"], [])
        self.assertEqual(mock_job.parameters["created_groups_resolved"], [])

    @patch("app.tasks.async_session_maker")
    @patch("app.tasks.auth_agent.get_access_token")
    @patch("app.tasks.GraphAPIClient")
    async def test_async_run_tcm_snapshot_import(self, mock_client_cls, mock_get_token, mock_session_maker):
        # Mocks
        mock_session = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        mock_get_token.return_value = "mock-token"
        mock_client = AsyncMock()
        mock_client_cls.return_value = mock_client

        org_id = uuid.uuid4()
        mock_org = Organization(id=org_id, name="Src Org", tenant_id="src-tenant")
        mock_org.credentials = [AppCredential(client_id="cid", client_secret="csec")]

        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = mock_org
        mock_session.execute.return_value = mock_execute_result

        # Graph API responses for polling and snapshot data
        # 1. Create Snapshot Job (POST) -> returns id
        mock_client.post_resource.return_value = {"id": "job-123"}
        
        # 2. Poll Status (GET) -> returns status completed, resourceLocation
        # 3. Download Snapshot (GET) -> returns the resources list
        mock_client.get_resource.side_effect = [
            {"status": "completed", "resourceLocation": "https://graph.microsoft.com/beta/admin/configurationManagement/configurationSnapshotJobs/job-123/snapshot"}, # status check
            {
                "value": [
                    {
                        "displayName": "TCM Compliance Policy",
                        "description": "Compliance baseline",
                        "resourceType": "deviceManagement/deviceCompliancePolicies",
                        "settings": {"requireBitLocker": True}
                    }
                ]
            } # download content
        ]

        from app.tasks import async_run_tcm_snapshot_import
        await async_run_tcm_snapshot_import(org_id, ["entra", "intune"])

        # Verification
        mock_client.post_resource.assert_called_once_with(
            endpoint="https://graph.microsoft.com/beta/admin/configurationManagement/configurationSnapshotJobs",
            payload={"workloads": ["entra", "intune"]}
        )
        mock_client.get_resource.assert_any_call("https://graph.microsoft.com/beta/admin/configurationManagement/configurationSnapshotJobs/job-123")
        mock_client.get_resource.assert_any_call("https://graph.microsoft.com/beta/admin/configurationManagement/configurationSnapshotJobs/job-123/snapshot")
        
        # Assertions on mock session: session.add was called to insert the template
        self.assertTrue(mock_session.add.called)
        added_template = mock_session.add.call_args[0][0]
        self.assertEqual(added_template.name, "TCM Compliance Policy")
        self.assertEqual(added_template.category, "intune")
        self.assertEqual(added_template.endpoint, "deviceManagement/deviceCompliancePolicies")


if __name__ == "__main__":
    unittest.main()
