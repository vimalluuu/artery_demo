from enum import StrEnum


class Role(StrEnum):
    CLINICIAN = "Clinician"  # Radiologist / Clinician
    RESEARCHER = "Researcher"  # Medical Researcher
    DATA_SCIENTIST = "DataScientist"  # Data Scientist / ML Engineer
    ADMIN = "Admin"  # Administrator


CLINICAL_WRITERS = (Role.CLINICIAN, Role.ADMIN)
CASE_READERS = tuple(Role)
