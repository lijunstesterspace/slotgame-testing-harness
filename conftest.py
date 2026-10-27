"""Repo-root pytest configuration.

The tests import `server.*`, which only works when the repo root is on sys.path. Running
`python -m pytest` happens to provide that (Python puts the working directory there), so the
suite passed while a plain `pytest` failed at collection with "ModuleNotFoundError: No module
named 'server'". pytest inserts the directory of every collected conftest.py, and this file's
directory is the repo root, so its presence is what makes the suite runnable from anywhere.
"""
