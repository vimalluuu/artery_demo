import os
import math
import vtk


# Dataset path can be configured for each computer.
DATASET_ROOT = os.environ.get(
    "ARTERY_DATASET_ROOT",
    r"D:\Artery_stenosis\ImageCAS-X_dataset"
)

SURFACE_DIR = os.path.join(DATASET_ROOT, "surfaces")
CENTERLINE_DIR = os.path.join(DATASET_ROOT, "centerlines")


def find_vtk_files(folder):
    """Return VTK files from a directory."""
    if not os.path.isdir(folder):
        print(f"Folder not found: {folder}")
        return []

    return sorted(
        os.path.join(folder, name)
        for name in os.listdir(folder)
        if name.lower().endswith(".vtk")
    )


def read_polydata(file_path):
    """Read a VTK legacy PolyData file."""
    reader = vtk.vtkPolyDataReader()
    reader.SetFileName(file_path)
    reader.Update()

    data = vtk.vtkPolyData()
    data.DeepCopy(reader.GetOutput())

    if data.GetNumberOfPoints() == 0:
        print(f"No readable points found: {file_path}")
        return None

    return data


def calculate_centerline_length(centerline):
    """Calculate polyline lengths from centerline cells."""
    total_length = 0.0
    valid_cells = 0

    print("\n--- Centerline Path Length Analysis ---")

    for cell_id in range(centerline.GetNumberOfCells()):
        cell = centerline.GetCell(cell_id)
        cell_length = 0.0

        for i in range(cell.GetNumberOfPoints() - 1):
            p1 = cell.GetPoints().GetPoint(i)
            p2 = cell.GetPoints().GetPoint(i + 1)

            dx = p2[0] - p1[0]
            dy = p2[1] - p1[1]
            dz = p2[2] - p1[2]

            cell_length += math.sqrt(
                dx * dx + dy * dy + dz * dz
            )

        if cell.GetNumberOfPoints() > 1:
            valid_cells += 1

        total_length += cell_length

        print(
            f"Cell {cell_id + 1}: "
            f"{cell.GetNumberOfPoints()} points, "
            f"length = {cell_length:.2f}"
        )

    print("Valid centerline cells:", valid_cells)
    print(f"Total summed cell length: {total_length:.2f}")
    print("Length units: dataset coordinate units")

    return total_length, valid_cells


def main():
    surfaces = find_vtk_files(SURFACE_DIR)
    centerlines = find_vtk_files(CENTERLINE_DIR)

    print("Dataset root:", DATASET_ROOT)
    print("Surface files found:", len(surfaces))
    print("Centerline files found:", len(centerlines))

    if not surfaces and not centerlines:
        raise SystemExit(
            "No VTK files found. Check ARTERY_DATASET_ROOT."
        )

    renderer = vtk.vtkRenderer()
    renderer.SetBackground(0.08, 0.10, 0.14)

    window = vtk.vtkRenderWindow()
    window.SetWindowName("3D Coronary Artery Visualization")
    window.SetSize(1100, 800)
    window.AddRenderer(renderer)

    interactor = vtk.vtkRenderWindowInteractor()
    interactor.SetRenderWindow(window)

    # Display the first readable surface.
    for surface_path in surfaces:
        surface = read_polydata(surface_path)

        if surface is None:
            continue

        bounds = surface.GetBounds()

        x_length = bounds[1] - bounds[0]
        y_length = bounds[3] - bounds[2]
        z_length = bounds[5] - bounds[4]

        print("\n--- 3D Surface Dimensions ---")
        print(f"X extent: {x_length:.2f}")
        print(f"Y extent: {y_length:.2f}")
        print(f"Z extent: {z_length:.2f}")
        print("Surface points:", surface.GetNumberOfPoints())

        mapper = vtk.vtkPolyDataMapper()
        mapper.SetInputData(surface)

        actor = vtk.vtkActor()
        actor.SetMapper(mapper)
        actor.GetProperty().SetColor(0.9, 0.3, 0.3)
        actor.GetProperty().SetOpacity(1.0)

        renderer.AddActor(actor)

        print("Displaying surface:", surface_path)
        break

    # Display the first readable centerline.
    for centerline_path in centerlines:
        centerline = read_polydata(centerline_path)

        if centerline is None:
            continue

        calculate_centerline_length(centerline)

        mapper = vtk.vtkPolyDataMapper()
        mapper.SetInputData(centerline)

        actor = vtk.vtkActor()
        actor.SetMapper(mapper)
        actor.GetProperty().SetColor(0.0, 1.0, 0.0)
        actor.GetProperty().SetLineWidth(4)
        actor.GetProperty().SetRenderLinesAsTubes(True)

        renderer.AddActor(actor)

        print("\n--- Centerline Summary ---")
        print("Displaying centerline:", centerline_path)
        print("Centerline points:", centerline.GetNumberOfPoints())
        print("Centerline cells:", centerline.GetNumberOfCells())
        print("Centerline bounds:", centerline.GetBounds())
        break

    renderer.ResetCamera()
    window.Render()

    interactor.Initialize()
    interactor.Start()


if __name__ == "__main__":
    main()