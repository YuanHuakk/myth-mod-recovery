local config = __RECOVERY_CONFIG__
local nativeLoadstring = loadstring
local root = config.root
local records, captured, allowed = {}, {}, {}
for _,relative in ipairs(config.files) do allowed[relative] = true end
local probeInput = ""
for _,value in ipairs(config.symbols) do probeInput = probeInput .. string.char(value) end
local probeCaptured

local safe = {}
for _,key in ipairs({"tonumber","tostring","type","pairs","ipairs","next","unpack","select","error","assert","pcall","xpcall","setmetatable","getmetatable","rawget","rawset","rawequal","_VERSION"}) do safe[key] = _G[key] end
for _,kind in ipairs({"string","table","math"}) do
    safe[kind] = {}
    for key,value in pairs(_G[kind]) do safe[kind][key] = value end
end
safe.collectgarbage = collectgarbage
safe.daxsg_tn = tonumber
safe.daxsg_nilstr = ""
safe._G, safe.GLOBAL, safe.env = safe, safe, safe
safe.MODROOT, safe.modname = root, "workshop-" .. config.workshopId
safe.TUNING = {}
for value = 65,90 do safe["KEY_" .. string.char(value)] = value + 32 end
safe.getfenv = function() return safe end
safe.setfenv = setfenv
safe.debug = {getupvalue = debug.getupvalue, traceback = debug.traceback, sethook = function() end, gethook = function() return nil end}
safe.debug.getinfo = function(fn, options)
    for key,value in pairs(safe) do
        if fn == value and type(_G[key]) == "function" then return debug.getinfo(_G[key], options) end
    end
    for _,kind in ipairs({"io","os","debug","string","table","math"}) do
        for key,value in pairs(safe[kind]) do
            if fn == value and type(_G[kind][key]) == "function" then return debug.getinfo(_G[kind][key], options) end
        end
    end
    return debug.getinfo(fn, options)
end
safe.os = {clock = os.clock, time = os.time, date = os.date, difftime = os.difftime}
safe.TheNet = {GetIsServer = function() return true end}
safe.TheSim = setmetatable({}, {__index = function() return function() return 0 end end})
safe.print = function() end
safe.__probe_message = function() end
safe.require = function(name) error("module omitted: " .. tostring(name)) end
safe.modimport = function() end
safe.kleiloadlua = function() error("original loader should not run") end

local function relativePath(name)
    if not name then return nil end
    name = name:gsub("^@", "")
    if name:sub(1, #root) ~= root then return nil end
    return name:sub(#root + 1):gsub("^scripts/%.%./", "")
end

safe.io = {open = function(name, mode)
    if mode ~= "r" and mode ~= "rb" then error("unexpected file mode") end
    local relative = relativePath(name)
    if config.mode == "mapping" and relative == "__byte_probe.lua" then
        local cursor = 1
        return {
            read = function(self, format)
                if cursor > #probeInput then
                    if type(format) == "number" then return nil else return "" end
                end
                local count = type(format) == "number" and format or #probeInput
                local value = probeInput:sub(cursor, cursor + count - 1)
                cursor = cursor + #value
                return value
            end,
            close = function() end,
        }
    end
    if not relative or not allowed[relative] then error("unexpected input path: " .. tostring(name)) end
    return io.open(root .. relative, mode)
end}

safe.loadstring = function(source, name)
    local relative = relativePath(name)
    if config.mode == "mapping" and relative == "__byte_probe.lua" then
        probeCaptured = source
        return function() return {} end
    end
    if relative then
        if not allowed[relative] then error("unexpected source path: " .. relative) end
        if config.mode == "mapping" then return function() return {} end end
        local fn,message = nativeLoadstring(source, name)
        if not fn then error(relative .. ": " .. tostring(message)) end
        if not captured[relative] then
            local file = assert(io.open(config.output .. relative, "wb"))
            assert(file:write(source))
            assert(file:close())
            captured[relative] = true
            records[#records + 1] = relative .. "\t" .. #source
        end
        -- Compilation and capture finish here; business code is never invoked.
        return function() return {} end
    end
    local fn,message = nativeLoadstring(source, name)
    if fn then setfenv(fn, safe) end
    return fn,message
end

safe.load = function(reader, name)
    local chunks = {}
    while true do
        local chunk = reader()
        if not chunk or chunk == "" then break end
        chunks[#chunks + 1] = chunk
    end
    return safe.loadstring(table.concat(chunks), name)
end

local function bounded(fn, ...)
    debug.sethook(function() error("loader instruction limit") end, "", 10000000)
    local ok,result = pcall(fn, ...)
    debug.sethook()
    if not ok then error(tostring(result)) end
    return result
end

local loader = assert(nativeLoadstring(config.stage, "@decoded-loader"))
setfenv(loader, safe)
bounded(loader)

local function decode(relative)
    if config.adapter == "loadfile" then
        return safe.loadfile("../" .. relative:gsub("%.lua$", ""))
    end
    return safe.kleiloadlua(root .. relative)
end

if config.mode == "mapping" then
    decode("__byte_probe.lua")
    assert(probeCaptured and #probeCaptured == #config.symbols, "incomplete loader mapping")
    return probeCaptured:gsub(".", function(c) return string.format("%02X", string.byte(c)) end)
end
for _,relative in ipairs(config.files) do
    if not captured[relative] then decode(relative) end
    assert(captured[relative], "source was not captured: " .. relative)
end
return table.concat(records, "\n")
