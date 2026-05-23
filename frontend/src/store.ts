import { configureStore, createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

type AuthUser = { _id: string; username: string; role: string; fullName?: string };

type AuthState = {
  token: string | null;
  user: AuthUser | null;
};

function loadStoredUser(): AuthUser | null {
  const raw = localStorage.getItem("authUser");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (!parsed || typeof parsed._id !== "string" || typeof parsed.username !== "string" || typeof parsed.role !== "string") {
      localStorage.removeItem("authUser");
      return null;
    }
    return {
      _id: parsed._id,
      username: parsed.username,
      role: parsed.role,
      fullName: typeof parsed.fullName === "string" ? parsed.fullName : undefined,
    };
  } catch {
    localStorage.removeItem("authUser");
    return null;
  }
}

const initialState: AuthState = {
  token: localStorage.getItem("token"),
  user: loadStoredUser(),
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setAuth(state, action: PayloadAction<AuthState>) {
      state.token = action.payload.token;
      state.user = action.payload.user;
      if (state.token) localStorage.setItem("token", state.token);
      else localStorage.removeItem("token");
      if (state.user) localStorage.setItem("authUser", JSON.stringify(state.user));
      else localStorage.removeItem("authUser");
    },
    clearAuth(state) {
      state.token = null;
      state.user = null;
      localStorage.removeItem("token");
      localStorage.removeItem("authUser");
    },
  },
});

export const { setAuth, clearAuth } = authSlice.actions;

export const store = configureStore({
  reducer: {
    auth: authSlice.reducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

