from backend.app.main import service


if __name__ == "__main__":
    state = service.state()
    print(f"Orbit FastAPI backend ready with {len(state.tasks)} tasks and {len(state.notes)} notes.")
