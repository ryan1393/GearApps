namespace LapperReadLibrary.BusinessLogic.Interfaces
{
    public interface IArgonaut
    {
        Task ArgoPostMacroLog(string serialNumber, string partNumber, int consec, CancellationToken cancellationToken = default);
    }
}
