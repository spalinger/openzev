from django.test import SimpleTestCase, override_settings


class AdminRouteTests(SimpleTestCase):
    def test_admin_route_follows_the_enabled_setting(self):
        import importlib
        from django.urls import Resolver404, clear_url_caches, resolve
        from config import urls

        try:
            for enabled in (False, True):
                with self.subTest(enabled=enabled), override_settings(ADMIN_ENABLED=enabled):
                    importlib.reload(urls)
                    clear_url_caches()
                    if enabled:
                        self.assertEqual(resolve("/admin/").view_name, "admin:index")
                    else:
                        with self.assertRaises(Resolver404):
                            resolve("/admin/")
        finally:
            importlib.reload(urls)
            clear_url_caches()
