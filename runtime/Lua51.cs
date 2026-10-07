using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class Lua51Bridge
{
    const string Dll = @"__LUA_DLL__";
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr luaL_newstate();
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] static extern void luaL_openlibs(IntPtr state);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] static extern int luaL_loadbuffer(IntPtr state, byte[] bytes, UIntPtr length, string name);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] static extern int lua_pcall(IntPtr state, int args, int results, int errorHandler);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr lua_tolstring(IntPtr state, int index, out UIntPtr length);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] static extern void lua_settop(IntPtr state, int index);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] static extern void lua_close(IntPtr state);

    static string Value(IntPtr state)
    {
        UIntPtr length;
        IntPtr pointer = lua_tolstring(state, -1, out length);
        if (pointer == IntPtr.Zero) return "";
        byte[] bytes = new byte[checked((int)length.ToUInt64())];
        Marshal.Copy(pointer, bytes, 0, bytes.Length);
        return Encoding.UTF8.GetString(bytes);
    }

    static IntPtr NewState()
    {
        IntPtr state = luaL_newstate();
        if (state == IntPtr.Zero) throw new InvalidOperationException("Lua state allocation failed");
        return state;
    }

    public static string Run(byte[] code)
    {
        IntPtr state = NewState();
        try
        {
            luaL_openlibs(state);
            int status = luaL_loadbuffer(state, code, (UIntPtr)code.Length, "@recovery-driver");
            if (status == 0) status = lua_pcall(state, 0, 1, 0);
            if (status != 0) throw new InvalidOperationException(Value(state));
            return Value(state);
        }
        finally { lua_close(state); }
    }

    public static string[] Compile(string[] paths)
    {
        List<string> errors = new List<string>();
        IntPtr state = NewState();
        try
        {
            foreach (string path in paths)
            {
                byte[] code = File.ReadAllBytes(path);
                if (luaL_loadbuffer(state, code, (UIntPtr)code.Length, "@" + path) != 0)
                    errors.Add(path + ": " + Value(state));
                lua_settop(state, 0);
            }
        }
        finally { lua_close(state); }
        return errors.ToArray();
    }
}
