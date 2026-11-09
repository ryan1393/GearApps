namespace LapperReadLibrary.BusinessLogic.Interfaces;

public interface IFanucTransport
{
    ushort Open(string ip, int timeoutSeconds);
    void Close(ushort handle);
    decimal? ReadMacro(ushort handle, short number);
    bool ReadPmc(ushort handle, short addressType, short dataType, ushort start, ushort end, int bit);
}
